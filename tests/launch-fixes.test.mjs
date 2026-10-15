import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { parseListingPrice, formatListingPrice } from '../src/lib/listing-price.ts';
import { paidMembershipIdentity } from '../src/lib/membership-validation.ts';
import { fetchMarketplace } from '../src/lib/marketplace-query.ts';

const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';

test('listing prices preserve cents and reject unsupported precision', () => {
  for (const [input, expected] of [['12.50', 12.5], ['12.', 12], ['.50', 0.5], ['0.01', 0.01], [19.99, 19.99], ['0', null], ['-1', null], ['1e3', null], ['12.345', null], ['Infinity', null], ['', null], ['9007199254740992', null]]) {
    assert.equal(parseListingPrice(input), expected, String(input));
  }
  assert.equal(formatListingPrice(12.5), '$12.50');
});

test('only verified account-bound, paid, configured-price sessions grant membership', () => {
  const session = {
    mode: 'payment', payment_status: 'paid', status: 'complete', client_reference_id: alice,
    metadata: { tier: 'founding_member', user_id: alice, fulfillment_version: 'account_v1' },
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_member' } }] },
    payment_intent: { latest_charge: { refunded: false, amount_refunded: 0 } },
  };
  const prices = { founding_member: 'price_member', founding_pro: 'price_pro' };
  assert.deepEqual(paidMembershipIdentity(session, prices), { userId: alice, tier: 'founding_member' });
  for (const change of [
    { payment_status: 'unpaid' }, { status: 'open' }, { client_reference_id: bob },
    { metadata: { tier: 'founding_member' } }, { line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'wrong' } }] } },
    { payment_intent: { latest_charge: { refunded: true, amount_refunded: 900 } } },
  ]) assert.equal(paidMembershipIdentity({ ...session, ...change }, prices), null);
});

test('missing browse RPC falls back to current schema with filters and pagination', async () => {
  const requests = [];
  const client = createClient('https://fixture.example', 'fixture-key', { global: { fetch: async (input, init) => {
    const url = new URL(input); requests.push(url);
    if (url.pathname.endsWith('/rpc/browse_marketplace')) return Response.json({ code: 'PGRST202', message: 'Missing function' }, { status: 404 });
    assert.equal(url.searchParams.get('status'), 'eq.active');
    assert.equal(url.searchParams.get('category'), 'eq.Textbooks');
    assert.equal(url.searchParams.get('campus'), 'eq.Main');
    assert.match(url.searchParams.get('order'), /price.asc/);
    assert.equal(new Headers(init.headers).get('range'), null); // Supabase encodes range as offset/limit.
    assert.equal(url.searchParams.get('offset'), '24');
    assert.equal(url.searchParams.get('limit'), '24');
    assert.ok(!url.searchParams.get('select').includes('boosted_until'));
    return Response.json([{ id: 'listing', seller: { id: alice }, title: 'Book' }], { headers: { 'Content-Range': '24-24/25' } });
  } } });
  const result = await fetchMarketplace(client, { query: 'book', category: 'Textbooks', campus: 'Main', sort: 'price-low', offset: 24 });
  assert.equal(result.error, null); assert.equal(result.data.length, 1);
  assert.equal(result.data[0].listing.boosted_until, null); assert.equal(result.data[0].total_count, 25);
  assert.equal(requests.length, 2);
});

test('permission errors are surfaced without falling back', async () => {
  let requests = 0;
  const client = createClient('https://fixture.example', 'fixture-key', { global: { fetch: async () => {
    requests++; return Response.json({ code: '42501', message: 'Permission denied' }, { status: 403 });
  } } });
  assert.equal((await fetchMarketplace(client)).error.code, '42501'); assert.equal(requests, 1);
});

test('automatic membership fulfillment is atomic and preserves all legacy code systems', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.profiles(id uuid primary key, whitelist_tier text, stripe_session_id text,
        boosts_used_this_month integer default 0, boost_reset_at timestamptz);
      create table public.whitelist_spots(tier text primary key, sold integer, total integer);
      create table public.founding_purchases(id integer primary key, secret_code text, used boolean);
      insert into public.founding_purchases values(1, 'REVIEW', true);
      create function public.redeem_magic_code(text,text) returns boolean language sql as $$ select false $$;
      grant execute on function public.redeem_magic_code(text,text) to authenticated;
      insert into public.profiles values('${alice}', null, null, 1, now() + interval '1 month'), ('${bob}', null, null, 0, null);
      insert into public.whitelist_spots values('founding_member', 0, 1), ('founding_pro', 0, 1);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/0005_paid_membership_fulfillment.sql', import.meta.url), 'utf8'));
    const fulfill = async (session, user = alice, tier = 'founding_member') =>
      (await db.query('select fulfill_paid_membership($1,$2,$3) as result', [session, user, tier])).rows[0].result;
    await t.test('service-only RPC, retry safety, one reservation, and upgrade preservation', async () => {
      await db.exec('set role service_role');
      assert.equal((await fulfill('cs_first')).status, 'fulfilled');
      assert.equal((await fulfill('cs_first')).status, 'fulfilled');
      assert.equal((await fulfill('cs_duplicate')).status, 'already_member');
      assert.equal((await fulfill('cs_upgrade', alice, 'founding_pro')).status, 'fulfilled');
      await db.exec('reset role');
      const profile = (await db.query('select * from profiles where id = $1', [alice])).rows[0];
      assert.equal(profile.whitelist_tier, 'founding_pro'); assert.equal(profile.boosts_used_this_month, 1);
      assert.equal((await db.query('select sold from whitelist_spots where tier = $1', ['founding_member'])).rows[0].sold, 1);
    });
    await t.test('sold out purchases do not grant benefits and return stable refund state', async () => {
      await db.exec('set role service_role');
      assert.equal((await fulfill('cs_soldout', bob)).status, 'sold_out');
      assert.equal((await fulfill('cs_soldout', bob)).status, 'sold_out');
      await db.exec('reset role');
      assert.equal((await db.query('select whitelist_tier from profiles where id = $1', [bob])).rows[0].whitelist_tier, null);
    });
    await t.test('clients cannot grant memberships; legacy data and RPC grants are untouched', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(fulfill('cs_forged', bob, 'founding_pro'), /permission denied/);
      assert.equal((await db.query("select redeem_magic_code('review','review') as result")).rows[0].result, false);
      await db.exec('reset role');
      assert.deepEqual((await db.query('select * from founding_purchases')).rows, [{ id: 1, secret_code: 'REVIEW', used: true }]);
    });
  } finally { await db.close(); }
});
