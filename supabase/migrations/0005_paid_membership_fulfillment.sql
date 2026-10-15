-- Standalone new checkout fulfillment. No magic-code tables, functions,
-- privileges, or legacy redemption systems are changed by this migration.
begin;
create table public.paid_membership_checkouts (
  session_id text primary key,
  user_id uuid not null references public.profiles(id),
  tier text not null check (tier in ('founding_member', 'founding_pro')),
  status text not null check (status in ('fulfilled', 'sold_out', 'already_member')),
  created_at timestamptz not null default now()
);
alter table public.paid_membership_checkouts enable row level security;
revoke all on public.paid_membership_checkouts from public, anon, authenticated;
grant all on public.paid_membership_checkouts to service_role;

create function public.fulfill_paid_membership(p_session_id text, p_user_id uuid, p_tier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_checkout public.paid_membership_checkouts%rowtype;
  v_spots public.whitelist_spots%rowtype;
  v_status text;
begin
  if p_session_id is null or p_session_id not like 'cs_%' or p_tier not in ('founding_member', 'founding_pro') or p_tier is null then
    raise exception 'Invalid paid membership metadata';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Purchasing account profile is missing'; end if;
  select * into v_checkout from public.paid_membership_checkouts where session_id = p_session_id;
  if found then
    if v_checkout.user_id <> p_user_id or v_checkout.tier <> p_tier then raise exception 'Checkout account mismatch'; end if;
    return jsonb_build_object('status', v_checkout.status, 'tier', v_checkout.tier);
  end if;
  if v_profile.whitelist_tier = 'founding_pro' or v_profile.whitelist_tier = p_tier then
    v_status := 'already_member';
  else
    select * into v_spots from public.whitelist_spots where tier = p_tier for update;
    if not found then raise exception 'Membership inventory is unavailable'; end if;
    if v_spots.sold >= v_spots.total then v_status := 'sold_out';
    else
      update public.whitelist_spots set sold = sold + 1 where tier = p_tier;
      update public.profiles set whitelist_tier = p_tier, stripe_session_id = p_session_id where id = p_user_id;
      -- Existing monthly usage/reset fields are deliberately preserved on upgrades.
      v_status := 'fulfilled';
    end if;
  end if;
  insert into public.paid_membership_checkouts(session_id, user_id, tier, status) values(p_session_id, p_user_id, p_tier, v_status);
  return jsonb_build_object('status', v_status, 'tier', p_tier);
end $$;
revoke all on function public.fulfill_paid_membership(text,uuid,text) from public, anon, authenticated;
grant execute on function public.fulfill_paid_membership(text,uuid,text) to service_role;
commit;
