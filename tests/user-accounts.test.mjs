import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isSignupPasswordValid, PASSWORD_REQUIREMENTS } from '../src/lib/password-validation.ts';

const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';

test('accounts and profiles are linked at signup, backfilled, and private', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '${alice}'::uuid $$;
      create table auth.users(id uuid primary key, email text, created_at timestamptz default now(),
        email_confirmed_at timestamptz, raw_user_meta_data jsonb);
      create table public.profiles(id uuid primary key references auth.users(id), username text unique,
        first_name text, last_name text, full_name text, school text, level_of_study text,
        program text, interests text[], whitelist_tier text);
      insert into auth.users(id,email) values('${alice}','alice@example.com');
      insert into profiles(id,username,first_name,whitelist_tier)
        values('${alice}','custom','Existing','founding_pro');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/0006_users_and_profiles.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('select count(*)::int as count from public.users')).rows[0].count, 1);
    assert.equal((await db.query('select whitelist_tier from profiles')).rows[0].whitelist_tier, 'founding_pro');
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`,
      [bob, 'wisileibazeyidio@gmail.com', JSON.stringify({ first_name: 'Test', last_name: 'User', interests: ['Books', 42] })]);
    const profile = (await db.query('select * from profiles where id = $1', [bob])).rows[0];
    assert.equal(profile.full_name, 'Test User');
    assert.deepEqual(profile.interests, ['Books']);
    assert.equal((await db.query('select email_confirmed_at from public.users where id = $1', [bob])).rows[0].email_confirmed_at, null);
    await db.query('update auth.users set email = $1, email_confirmed_at = now() where id = $2', ['updated@example.com', bob]);
    const account = (await db.query('select * from public.users where id = $1', [bob])).rows[0];
    assert.equal(account.email, 'updated@example.com');
    assert.ok(account.email_confirmed_at);
    await db.exec('set role authenticated');
    assert.deepEqual((await db.query('select id from public.users')).rows, [{ id: alice }]);
    await assert.rejects(db.query('update public.users set email = $1', ['forged@example.com']), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query('insert into profiles(id) values($1)', ['10000000-0000-4000-8000-000000000003']), /foreign key/);
    await db.query('delete from public.users where id = $1', [bob]);
    assert.equal((await db.query('select count(*)::int as count from profiles where id = $1', [bob])).rows[0].count, 0);
  } finally { await db.close(); }
});

test('backend restricts signup to institution domains and returns verification as success', async () => {
  const source = await readFile(new URL('../src/app/onboarding/actions.ts', import.meta.url), 'utf8');
  // Exercise the real Server Action with an isolated authentication provider.
  const action = source.replace(/^import .*;\r?\n/gm, '')
    .replace('const SCHOOL_EMAIL_DOMAINS: Record<string, string>', 'const SCHOOL_EMAIL_DOMAINS')
    .replace('const SCHOOL_NAMES: Record<string, string>', 'const SCHOOL_NAMES')
    .replace('email: string, schoolId: string): boolean', 'email, schoolId)')
    .replace('raw: unknown): string | null', 'raw)')
    .replace(/err: \{[\s\S]*?\}\): boolean/, 'err)')
    .replace(/interface OnboardingData \{[\s\S]*?\}\r?\n/, '')
    .replace('data: OnboardingData', 'data');
  const calls = [];
  globalThis.__signupTest = { auth: { signUp: async (data) => { calls.push(data); return { data: {}, error: null }; } } };
  try {
    const validationUrl = new URL('../src/lib/password-validation.ts', import.meta.url).href;
    const module = await import(`data:text/javascript,${encodeURIComponent(`import { isSignupPasswordValid, PASSWORD_REQUIREMENTS } from '${validationUrl}';\nconst createClient = async () => globalThis.__signupTest;\n` + action)}`);
    const data = { university: 'carleton', firstName: 'Test', lastName: 'User', interests: [], password: 'Test-pass1' };
    for (const password of ['Short1!', 'lowercase1!', 'NoNumber!', 'NoSymbol1', 'Spaces1 ']) {
      assert.equal((await module.createAccountAndProfile({ ...data, email: 'student@cmail.carleton.ca', password })).error, PASSWORD_REQUIREMENTS);
    }
    assert.equal(calls.length, 0);
    assert.ok((await module.createAccountAndProfile({ ...data, email: ' WISILEIBAZEYIDIO@gmail.com ' })).error);
    assert.ok((await module.createAccountAndProfile({ ...data, email: 'other@gmail.com' })).error);
    assert.ok((await module.createAccountAndProfile({ ...data, university: 'invalid', email: 'wisileibazeyidio@gmail.com' })).error);
    assert.equal(calls.length, 0);
    const result = await module.createAccountAndProfile({ ...data, email: ' Student@cmail.carleton.ca ' });
    assert.equal(result.needsVerification, true);
    assert.equal(result.error, undefined);
    assert.equal(calls[0].email, 'student@cmail.carleton.ca');
  } finally { delete globalThis.__signupTest; }
});

test('signup password requires eight characters, an uppercase letter, number, and symbol', () => {
  for (const password of ['Abcdef1!', 'UPPER12!', 'Longer Password1!']) assert.equal(isSignupPasswordValid(password), true);
  for (const password of ['', 'Abcd1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 ', null, 12345678]) {
    assert.equal(isSignupPasswordValid(password), false);
  }
});
