-- Apply before deploying the founding-benefits UI. Existing paid tiers are preserved.
begin;

alter table public.profiles
  add column if not exists whitelist_tier text,
  add column if not exists boosts_used_this_month integer not null default 0,
  add column if not exists boost_reset_at timestamptz,
  add column if not exists stripe_session_id text;
alter table public.founding_purchases
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists linked_at timestamptz,
  add column if not exists used boolean not null default false;
alter table public.listings add column if not exists boosted_until timestamptz;
create index if not exists listings_boost_expiry_idx on public.listings(boosted_until)
  where status = 'active';

create table public.listing_boost_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  listing_id uuid not null references public.listings(id) on delete cascade,
  request_key uuid not null,
  activated_at timestamptz not null,
  expires_at timestamptz not null,
  unique(user_id, request_key)
);
alter table public.listing_boost_events enable row level security;
create policy "owners can read boost history" on public.listing_boost_events
  for select to authenticated using (user_id = auth.uid());
revoke all on public.listing_boost_events from public, anon, authenticated;
grant select on public.listing_boost_events to authenticated;
grant all on public.listing_boost_events to service_role;

create table public.founding_claim_attempts (
  user_id uuid primary key references public.profiles(id),
  attempts integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.founding_claim_attempts enable row level security;
revoke all on public.founding_claim_attempts from public, anon, authenticated;
grant all on public.founding_claim_attempts to service_role;

-- Codes and payment references are private; users claim through the RPC only.
revoke all on public.founding_purchases from public, anon, authenticated;
grant all on public.founding_purchases to service_role;

-- Retire legacy RPCs that accept a caller-supplied user/tier or consume a code
-- before an authenticated account exists. Webhook-only RPCs remain service-only.
do $$
declare f record;
begin
  for f in select oid::regprocedure as signature from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('redeem_magic_code', 'claim_whitelist_spot', 'claim_founding_spot_guest')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    if f.signature::text like '%claim_founding_spot_guest%' then
      execute format('grant execute on function %s to service_role', f.signature);
    end if;
  end loop;
end $$;

-- Table-wide UPDATE privileges already exist in this app. Triggers protect
-- paid fields even when clients bypass the UI and issue direct REST writes.
create function public.guard_founding_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then
      if old.whitelist_tier is not null then
        raise exception 'Paid profiles must be removed through account support' using errcode = '42501';
      end if;
      return old;
    elsif tg_op = 'INSERT' then
      if new.whitelist_tier is not null or new.boosts_used_this_month <> 0
        or new.boost_reset_at is not null or new.stripe_session_id is not null then
        raise exception 'Paid membership fields cannot be set directly' using errcode = '42501';
      end if;
    elsif new.id is distinct from old.id
      or new.whitelist_tier is distinct from old.whitelist_tier
      or new.boosts_used_this_month is distinct from old.boosts_used_this_month
      or new.boost_reset_at is distinct from old.boost_reset_at
      or new.stripe_session_id is distinct from old.stripe_session_id then
      raise exception 'Paid membership fields cannot be changed directly' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_founding_fields before insert or update or delete on public.profiles
  for each row execute function public.guard_founding_fields();

create function public.guard_listing_boost() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.boosted_until is not null)
      or (tg_op = 'UPDATE' and new.boosted_until is distinct from old.boosted_until) then
      raise exception 'Use the boost action to promote a listing' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
      raise exception 'Listing ownership cannot be transferred' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protect_listing_boost before insert or update on public.listings
  for each row execute function public.guard_listing_boost();

create function public.founding_boost_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_quota integer;
  v_now timestamptz := clock_timestamp();
  v_reset timestamptz := (date_trunc('month', v_now at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  v_used integer;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in to view your benefits.'); end if;
  select * into v_profile from public.profiles where id = auth.uid();
  v_quota := case v_profile.whitelist_tier when 'founding_member' then 1 when 'founding_pro' then 3 else 0 end;
  v_used := case when v_profile.boost_reset_at = v_reset then greatest(0, coalesce(v_profile.boosts_used_this_month, 0)) else 0 end;
  return jsonb_build_object('tier', v_profile.whitelist_tier, 'remaining', greatest(0, v_quota - v_used),
    'quota', v_quota, 'resetAt', v_reset, 'serverNow', v_now);
end $$;

create function public.claim_founding_membership(p_email text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_purchase public.founding_purchases%rowtype;
  v_attempts integer;
  v_tier text;
begin
  if v_user is null then return jsonb_build_object('error', 'Sign in to claim your membership.'); end if;
  if not exists(select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    return jsonb_build_object('error', 'Verify your account email before claiming your membership.');
  end if;
  select * into v_profile from public.profiles where id = v_user for update;
  if not found then return jsonb_build_object('error', 'Complete your profile before claiming your membership.'); end if;
  insert into public.founding_claim_attempts(user_id, attempts) values(v_user, 1)
  on conflict(user_id) do update set
    attempts = case when founding_claim_attempts.window_start <= statement_timestamp() - interval '1 hour' then 1 else founding_claim_attempts.attempts + 1 end,
    window_start = case when founding_claim_attempts.window_start <= statement_timestamp() - interval '1 hour' then statement_timestamp() else founding_claim_attempts.window_start end
  returning attempts into v_attempts;
  if v_attempts > 10 then return jsonb_build_object('error', 'Too many claim attempts. Try again in an hour.'); end if;
  select * into v_purchase from public.founding_purchases
    where lower(trim(email)) = lower(trim(p_email)) and upper(trim(secret_code)) = upper(trim(p_code))
    order by created_at desc limit 1 for update;
  if not found or v_purchase.tier not in ('founding_member', 'founding_pro')
    or (v_purchase.user_id is not null and v_purchase.user_id <> v_user) then
    return jsonb_build_object('error', 'Purchase email or code is invalid, or the purchase belongs to another account.');
  end if;
  if v_purchase.used and v_purchase.user_id is null then
    return jsonb_build_object('error', 'This code was redeemed through the previous signup flow. Contact support to recover your membership.');
  end if;
  v_tier := case when v_profile.whitelist_tier = 'founding_pro' then 'founding_pro' else v_purchase.tier end;
  update public.founding_purchases set user_id = v_user, linked_at = coalesce(linked_at, statement_timestamp()), used = true
    where id = v_purchase.id;
  update public.profiles set whitelist_tier = v_tier, stripe_session_id = v_purchase.stripe_checkout_session_id
    where id = v_user;
  -- Retries/upgrades preserve usage and its existing reset boundary.
  return public.founding_boost_status();
end $$;

create function public.activate_listing_boost(p_listing_id uuid, p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_listing public.listings%rowtype;
  v_event public.listing_boost_events%rowtype;
  v_quota integer;
  v_used integer;
  v_now timestamptz;
  v_reset timestamptz;
begin
  if v_user is null then return jsonb_build_object('error', 'Sign in to boost your listing.'); end if;
  if p_request_key is null then return jsonb_build_object('error', 'A request key is required.'); end if;
  select * into v_profile from public.profiles where id = v_user for update;
  if not found then return jsonb_build_object('error', 'Complete your profile first.'); end if;
  select * into v_event from public.listing_boost_events where user_id = v_user and request_key = p_request_key;
  if found then
    if v_event.listing_id <> p_listing_id then return jsonb_build_object('error', 'This request key belongs to another listing.'); end if;
    return public.founding_boost_status() || jsonb_build_object('boostedUntil', v_event.expires_at);
  end if;
  v_quota := case v_profile.whitelist_tier when 'founding_member' then 1 when 'founding_pro' then 3 else 0 end;
  if v_quota = 0 then return jsonb_build_object('error', 'A Founding membership is required to boost listings.'); end if;
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.user_id <> v_user then return jsonb_build_object('error', 'You can only boost your own listings.'); end if;
  if v_listing.status <> 'active' then return jsonb_build_object('error', 'Only active listings can be boosted.'); end if;
  -- Evaluate the month after lock acquisition: a queued request that crosses
  -- midnight must not move a newer quota window back into the previous month.
  v_now := clock_timestamp();
  v_reset := (date_trunc('month', v_now at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  if v_listing.boosted_until > v_now then return jsonb_build_object('error', 'This listing is already boosted.'); end if;
  v_used := case when v_profile.boost_reset_at = v_reset then greatest(0, coalesce(v_profile.boosts_used_this_month, 0)) else 0 end;
  if v_used >= v_quota then return jsonb_build_object('error', 'You have used all your boosts this month.'); end if;
  update public.profiles set boosts_used_this_month = v_used + 1, boost_reset_at = v_reset where id = v_user;
  update public.listings set boosted_until = v_now + interval '7 days' where id = p_listing_id;
  insert into public.listing_boost_events(user_id, listing_id, request_key, activated_at, expires_at)
    values(v_user, p_listing_id, p_request_key, v_now, v_now + interval '7 days');
  return public.founding_boost_status() || jsonb_build_object('boostedUntil', v_now + interval '7 days');
end $$;

-- SECURITY INVOKER preserves existing listing/profile RLS. Ranking happens
-- before LIMIT/OFFSET, and database time determines active promotion.
create function public.browse_marketplace(
  p_query text default '', p_category text default null, p_campus text default null,
  p_sort text default 'recommended', p_limit integer default 24, p_offset integer default 0
) returns table(listing jsonb, total_count bigint, server_now timestamptz)
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', l.id, 'title', l.title, 'description', l.description, 'price', l.price,
    'category', l.category, 'condition', l.condition, 'campus', l.campus,
    'image_url', l.image_url, 'created_at', l.created_at, 'boosted_until', l.boosted_until,
    'seller', jsonb_build_object('id', p.id, 'first_name', p.first_name, 'full_name', p.full_name,
      'avatar_url', p.avatar_url, 'whitelist_tier', p.whitelist_tier)
  ), count(*) over(), statement_timestamp()
  from public.listings l join public.profiles p on p.id = l.user_id
  where l.status = 'active'
    and (coalesce(trim(p_query), '') = '' or position(lower(trim(p_query)) in lower(l.title || ' ' || coalesce(l.description, ''))) > 0)
    and (p_category is null or l.category = p_category)
    and (p_campus is null or l.campus = p_campus)
  order by
    case when p_sort not in ('newest', 'price-low', 'price-high') or p_sort is null
      then coalesce(l.boosted_until > statement_timestamp(), false) else false end desc,
    case when p_sort = 'price-low' then l.price end asc,
    case when p_sort = 'price-high' then l.price end desc,
    l.created_at desc, l.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 48)) offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.founding_boost_status(), public.claim_founding_membership(text,text),
  public.activate_listing_boost(uuid,uuid), public.browse_marketplace(text,text,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.founding_boost_status(), public.claim_founding_membership(text,text),
  public.activate_listing_boost(uuid,uuid) to authenticated;
grant execute on function public.browse_marketplace(text,text,text,text,integer,integer) to anon, authenticated;
revoke all on function public.guard_founding_fields(), public.guard_listing_boost() from public, anon, authenticated;
commit;
