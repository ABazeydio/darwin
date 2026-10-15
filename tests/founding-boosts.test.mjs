import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const unverified = '10000000-0000-4000-8000-000000000003';
const listing = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const third = '20000000-0000-4000-8000-000000000003';
const foreign = '20000000-0000-4000-8000-000000000004';
const sold = '20000000-0000-4000-8000-000000000005';
const key = '30000000-0000-4000-8000-000000000001';
const key2 = '30000000-0000-4000-8000-000000000002';

test('founding purchase claims, quotas, permissions, and discovery', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key references auth.users(id),
        first_name text, full_name text, avatar_url text, bio text);
      create table public.listings(id uuid primary key, user_id uuid references public.profiles(id),
        title text not null, description text, price numeric not null, category text, condition text,
        campus text, image_url text, status text not null default 'active', created_at timestamptz default now());
      create table public.founding_purchases(id uuid primary key default gen_random_uuid(), email text not null,
        secret_code char(6) not null, tier text not null, stripe_checkout_session_id text not null,
        created_at timestamptz default now(), user_id uuid, linked_at timestamptz);
      create function public.claim_whitelist_spot(p_user_id uuid, p_tier text, p_order_id text)
        returns void language sql security definer as $$ select $$;
      create function public.redeem_magic_code(p_email text, p_code text)
        returns boolean language sql security definer as $$ select true $$;
      create function public.claim_founding_spot_guest(p_email text, p_tier text, p_order_id text)
        returns boolean language sql security definer as $$ select true $$;
      grant all on public.profiles, public.listings, public.founding_purchases to anon, authenticated, service_role;
      alter table public.profiles enable row level security;
      create policy profile_read on public.profiles for select using (true);
      create policy profile_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
      create policy profile_insert on public.profiles for insert to authenticated with check (id = auth.uid());
      create policy profile_delete on public.profiles for delete to authenticated using (id = auth.uid());
      alter table public.listings enable row level security;
      create policy listing_read on public.listings for select using (status = 'active' or user_id = auth.uid());
      create policy listing_update on public.listings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
      create policy listing_insert on public.listings for insert to authenticated with check (user_id = auth.uid());
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/0004_founding_boosts.sql', import.meta.url), 'utf8'));
    await db.exec(`
      insert into auth.users values ('${alice}', now()), ('${bob}', now()), ('${unverified}', null);
      insert into public.profiles(id, full_name) values ('${alice}', 'Alice'), ('${bob}', 'Bob'), ('${unverified}', 'Unverified');
      insert into public.founding_purchases(email, secret_code, tier, stripe_checkout_session_id) values
        ('buyer@example.com', 'A1B2C3', 'founding_member', 'cs_member'),
        ('pro@example.com', 'D4E5F6', 'founding_pro', 'cs_pro');
      insert into public.listings(id,user_id,title,price,category,campus,status,created_at) values
        ('${listing}', '${alice}', 'Old calculus book', 50, 'Textbooks', 'Main', 'active', now() - interval '90 days'),
        ('${second}', '${alice}', 'New calculus book', 5, 'Textbooks', 'Main', 'active', now()),
        ('${third}', '${alice}', 'Desk', 20, 'Furniture', 'North', 'active', now() - interval '1 day'),
        ('${foreign}', '${bob}', 'Laptop', 100, 'Electronics', 'North', 'active', now()),
        ('${sold}', '${alice}', 'Sold calculus book', 1, 'Textbooks', 'Main', 'sold', now());
    `);
    const asUser = async (user = alice) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
      await db.exec('set role authenticated');
    };
    const admin = () => db.exec('reset role');
    const call = async (sql, args = []) => (await db.query(`select ${sql} as result`, args)).rows[0].result;
    const claim = (email = 'buyer@example.com', code = 'A1B2C3') => call('public.claim_founding_membership($1, $2)', [email, code]);
    const boost = (id = listing, request = key) => call('public.activate_listing_boost($1, $2)', [id, request]);
    const denied = async (sql, args = []) => {
      await db.exec('savepoint denied');
      try { await assert.rejects(db.query(sql, args), /permission denied|cannot be|boost action|ownership|Paid profiles/); }
      finally { await db.exec('rollback to savepoint denied'); }
    };
    const scenario = async (name, fn) => t.test(name, async () => {
      await admin(); await db.exec('begin');
      try { await asUser(); await fn(); } finally { await db.exec('rollback'); await admin(); }
    });

    await scenario('valid purchase assigns tier; repeats and upgrades preserve consumed allowance', async () => {
      assert.equal((await claim(' BUYER@example.com ', 'a1b2c3')).tier, 'founding_member');
      assert.equal((await boost()).remaining, 0);
      assert.equal((await claim()).remaining, 0);
      const upgraded = await claim('pro@example.com', 'D4E5F6');
      assert.equal(upgraded.tier, 'founding_pro'); assert.equal(upgraded.remaining, 2);
      assert.equal((await claim()).tier, 'founding_pro');
      await asUser(bob); assert.match((await claim()).error, /another account/);
    });
    await scenario('invalid and unverified claims do not consume purchases', async () => {
      assert.match((await claim('buyer@example.com', 'WRONG1')).error, /invalid/);
      await asUser(unverified); assert.match((await claim()).error, /Verify/);
      await asUser(); assert.equal((await claim()).tier, 'founding_member');
    });
    await scenario('legacy consumed unlinked code requires recovery', async () => {
      await admin(); await db.exec("update founding_purchases set used = true where stripe_checkout_session_id = 'cs_member'");
      await asUser(); assert.match((await claim()).error, /previous signup flow/);
    });
    await scenario('six-character codes are rate limited and invalid attempts persist', async () => {
      for (let i = 0; i < 10; i++) assert.match((await claim('buyer@example.com', 'WRONG1')).error, /invalid/);
      assert.match((await claim()).error, /Too many/);
      await admin(); await db.exec("update founding_claim_attempts set window_start = now() - interval '2 hours'");
      await asUser(); assert.equal((await claim()).tier, 'founding_member');
    });
    await scenario('nonmembers, other sellers, and sold listings cannot consume quota', async () => {
      assert.match((await boost()).error, /membership/);
      await claim();
      assert.match((await boost(foreign)).error, /own listings/);
      assert.match((await boost(sold)).error, /active listings/);
      assert.equal((await call('public.founding_boost_status()')).remaining, 1);
    });
    await scenario('activation is exactly seven days; retries spend once; exhausted quota fails', async () => {
      await claim();
      const first = await boost(); assert.equal(first.remaining, 0);
      const retry = await boost(); assert.equal(retry.boostedUntil, first.boostedUntil);
      assert.equal(retry.remaining, 0);
      assert.match((await boost(second, key)).error, /another listing/);
      assert.match((await boost(listing, key2)).error, /already boosted/);
      assert.match((await boost(second, key2)).error, /all your boosts/);
      const duration = (await db.query('select extract(epoch from (expires_at - activated_at)) as seconds from listing_boost_events')).rows[0].seconds;
      assert.equal(Number(duration), 7 * 24 * 60 * 60);
    });
    await scenario('simultaneous queued requests cannot overspend', async () => {
      await claim();
      const results = await Promise.all([boost(), boost(second, key2)]);
      assert.equal(results.filter((r) => !r.error).length, 1);
      assert.equal((await call('public.founding_boost_status()')).remaining, 0);
    });
    await scenario('pro receives three boosts; no rollover and current month retries do not reset usage', async () => {
      await claim('pro@example.com', 'D4E5F6');
      assert.equal((await boost()).remaining, 2);
      assert.equal((await boost(second, key2)).remaining, 1);
      assert.equal((await boost(third, '30000000-0000-4000-8000-000000000003')).remaining, 0);
    });
    await scenario('expired UTC period resets lazily, even across non-UTC database sessions', async () => {
      await claim(); await boost();
      await admin();
      await db.exec(`update profiles set boost_reset_at = now() - interval '1 day' where id = '${alice}';
        update listings set boosted_until = now() - interval '1 second' where id = '${listing}'; set time zone 'America/New_York';`);
      await asUser();
      const status = await call('public.founding_boost_status()'); assert.equal(status.remaining, 1);
      assert.match(new Date(status.resetAt).toISOString(), /01T00:00:00/);
      assert.equal((await boost(listing, key2)).remaining, 0);
    });
    await scenario('direct profile and listing writes cannot forge entitlements or reset quota', async () => {
      await denied("update profiles set whitelist_tier = 'founding_pro' where id = $1", [alice]);
      await denied('update listings set boosted_until = now() + interval \'1 year\' where id = $1', [listing]);
      await claim(); await boost();
      await denied('update profiles set boosts_used_this_month = 0 where id = $1', [alice]);
      await denied('delete from profiles where id = $1', [alice]);
      await db.query('update profiles set bio = $1 where id = $2', ['Normal edits still work', alice]);
    });
    await scenario('purchase codes, ledgers and legacy tier-setting RPCs are private', async () => {
      await denied('select * from founding_purchases');
      await denied('select public.claim_whitelist_spot($1, $2, $3)', [alice, 'founding_pro', 'fake']);
      await denied('select public.redeem_magic_code($1, $2)', ['buyer@example.com', 'A1B2C3']);
      await denied('select public.claim_founding_spot_guest($1, $2, $3)', ['buyer@example.com', 'founding_pro', 'fake']);
      await denied('insert into listing_boost_events(user_id,listing_id,request_key,activated_at,expires_at) values($1,$2,$3,now(),now())', [alice, listing, key]);
      await claim(); await boost(); await asUser(bob);
      assert.equal((await db.query('select * from listing_boost_events')).rows.length, 0);
    });
    await scenario('boosts rank before pagination; explicit sorting and filters stay intact', async () => {
      await claim(); await boost();
      const browse = async (sort = 'recommended', category = null, campus = null, query = '') =>
        (await db.query('select * from browse_marketplace($1,$2,$3,$4,1,0)', [query, category, campus, sort])).rows;
      assert.equal((await browse())[0].listing.id, listing);
      assert.equal((await browse('price-low'))[0].listing.id, second);
      assert.notEqual((await browse('newest'))[0].listing.id, listing);
      assert.equal((await browse('recommended', 'Furniture'))[0].listing.id, third);
      assert.notEqual((await browse('recommended', null, 'North'))[0].listing.id, listing);
      assert.equal((await browse('recommended', null, null, 'calculus'))[0].listing.id, listing);
      assert.equal((await browse('recommended', null, null, '%')).length, 0);
      assert.equal(Number((await browse())[0].total_count), 4); // Sold listing is excluded.
      await admin(); await db.exec(`update listings set boosted_until = statement_timestamp() where id = '${listing}'`);
      await asUser(); assert.notEqual((await browse())[0].listing.id, listing);
    });
    await scenario('anonymous visitors can browse but cannot activate or claim', async () => {
      await admin(); await db.exec('set role anon');
      assert.equal((await db.query('select * from browse_marketplace()')).rows.length, 4);
      await denied('select activate_listing_boost($1,$2)', [listing, key]);
      await denied('select claim_founding_membership($1,$2)', ['buyer@example.com', 'A1B2C3']);
    });
  } finally { await db.close(); }
});
