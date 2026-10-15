import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Webhook } from 'standardwebhooks';
import { authEmailMessage } from '../src/lib/auth-email.ts';

const secret = `whsec_${Buffer.from('test-secret-with-enough-entropy-123').toString('base64')}`;
const config = { secret: `v1,${secret}`, siteUrl: 'https://darwin.example', from: 'Darwin <auth@example.com>', signupTemplate: 'signup-id', recoveryTemplate: 'recovery-id' };
function signed(type = 'signup', redirect = 'https://darwin.example/auth/callback?next=/sell', date = new Date()) {
  const body = JSON.stringify({ user: { email: 'student@cmail.carleton.ca' }, email_data: { email_action_type: type, token_hash: 'token-hash', redirect_to: redirect } });
  return { body, headers: { 'webhook-id': 'test-id', 'webhook-timestamp': String(Math.floor(date.getTime() / 1000)), 'webhook-signature': new Webhook(secret).sign('test-id', date, body) } };
}

test('signed auth emails select the published template and safe action URL', () => {
  const signup = signed();
  const message = authEmailMessage(signup.body, signup.headers, config);
  assert.equal(message.to, 'student@cmail.carleton.ca');
  assert.equal(message.template.id, 'signup-id');
  const url = new URL(message.template.variables.ACTION_URL);
  assert.equal(url.origin, config.siteUrl);
  assert.equal(url.pathname, '/auth/confirm');
  assert.equal(url.searchParams.get('next'), '/sell');
  assert.equal(url.searchParams.get('token_hash'), 'token-hash');
  const recovery = signed('recovery');
  const reset = authEmailMessage(recovery.body, recovery.headers, config);
  assert.equal(reset.template.id, 'recovery-id');
  assert.equal(new URL(reset.template.variables.ACTION_URL).searchParams.get('next'), '/reset-password');
  for (const redirect of ['https://evil.example/?next=/sell', 'https://darwin.example/?next=//evil.example', 'https://darwin.example/?next=/%5Cevil.example']) {
    const event = signed('signup', redirect);
    assert.equal(new URL(authEmailMessage(event.body, event.headers, config).template.variables.ACTION_URL).searchParams.get('next'), '/browse');
  }
});

test('tampered, unsigned, expired, unsupported, and unconfigured emails fail closed', () => {
  const event = signed();
  assert.throws(() => authEmailMessage(event.body.replace('student', 'attacker'), event.headers, config));
  assert.throws(() => authEmailMessage(event.body, {}, config));
  const expired = signed('signup', undefined, new Date(Date.now() - 600_000));
  assert.throws(() => authEmailMessage(expired.body, expired.headers, config));
  const unsupported = signed('email_change');
  assert.throws(() => authEmailMessage(unsupported.body, unsupported.headers, config), /Unsupported/);
  assert.throws(() => authEmailMessage(event.body, event.headers, { ...config, signupTemplate: '' }), /not configured/);
});

test('email route sends once per webhook id, propagates provider failures, and rejects invalid signatures', async () => {
  const source = await readFile(new URL('../src/app/api/auth/send-email/route.ts', import.meta.url), 'utf8');
  const helper = new URL('../src/lib/auth-email.ts', import.meta.url).href;
  const standard = new URL('../node_modules/standardwebhooks/dist/index.js', import.meta.url).href;
  const code = source.replace(/^import .*;\r?\n/gm, '').replace('request: Request', 'request');
  const calls = [];
  globalThis.__emailTest = { result: { error: null }, send: async (message, options) => { calls.push({ message, options }); return globalThis.__emailTest.result; } };
  const variables = { SEND_EMAIL_HOOK_SECRET: config.secret, RESEND_API_KEY: 'test', NEXT_PUBLIC_SITE_URL: config.siteUrl, RESEND_SIGNUP_TEMPLATE_ID: config.signupTemplate, RESEND_RECOVERY_TEMPLATE_ID: config.recoveryTemplate };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  try {
    const route = await import(`data:text/javascript,${encodeURIComponent(`import { authEmailMessage } from '${helper}'; import { WebhookVerificationError } from '${standard}'; class Resend { emails = { send: (...args) => globalThis.__emailTest.send(...args) }; }\n` + code)}`);
    const event = signed();
    const request = () => new Request('https://darwin.example/api/auth/send-email', { method: 'POST', headers: event.headers, body: event.body });
    assert.equal((await route.POST(request())).status, 200);
    assert.equal(calls[0].options.idempotencyKey, 'auth-email/test-id');
    globalThis.__emailTest.result = { error: { name: 'validation_error' } };
    assert.equal((await route.POST(request())).status, 502);
    assert.equal((await route.POST(new Request('https://darwin.example/api/auth/send-email', { method: 'POST', body: event.body }))).status, 401);
    assert.equal(calls.length, 2);
  } finally {
    delete globalThis.__emailTest;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('password recovery requires an authenticated session and validates new passwords before updating', async () => {
  const source = await readFile(new URL('../src/app/(auth)/reset-password/actions.ts', import.meta.url), 'utf8');
  const validation = new URL('../src/lib/password-validation.ts', import.meta.url).href;
  const code = source.replace(/^import .*;\r?\n/gm, '').replace('email: string', 'email').replace('password: string', 'password');
  const calls = [];
  globalThis.__recoveryTest = { auth: {
    getUser: async () => ({ data: { user: globalThis.__recoveryTest.user } }),
    updateUser: async (data) => { calls.push(data); return { error: null }; },
    signOut: async () => { calls.push('signout'); return { error: null }; },
    resetPasswordForEmail: async (email, options) => { calls.push({ email, options }); return { error: null }; },
  }, user: null };
  try {
    const actions = await import(`data:text/javascript,${encodeURIComponent(`import { isSignupPasswordValid, PASSWORD_REQUIREMENTS } from '${validation}'; const createClient = async () => globalThis.__recoveryTest;\n` + code)}`);
    assert.ok((await actions.resetPassword('weak')).error);
    assert.equal(calls.length, 0);
    assert.ok((await actions.resetPassword('Strong1!')).error);
    assert.equal(calls.length, 0);
    globalThis.__recoveryTest.user = { id: 'test-user' };
    assert.equal((await actions.resetPassword('Strong1!')).success, true);
    assert.deepEqual(calls, [{ password: 'Strong1!' }, 'signout']);
    assert.ok((await actions.requestPasswordRecovery('invalid-email')).error);
    assert.equal((await actions.requestPasswordRecovery(' Student@cmail.carleton.ca ')).success, true);
    assert.equal(calls[2].email, 'student@cmail.carleton.ca');
    assert.ok(calls[2].options.redirectTo.endsWith('/auth/callback?next=/reset-password'));
  } finally { delete globalThis.__recoveryTest; }
});
