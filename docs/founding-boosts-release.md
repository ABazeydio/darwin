# Founding benefits release

Superseded for checkout/linking by [the October 12 launch updates](launch-fixes.md). The legacy/magic-code changes in migration 0004 remain under review; do not apply that migration as part of the new account-bound checkout release.

## Shipped in the source

- Founding Member and Founding Pro badges appear on private/public profiles and listing seller surfaces.
- Buyers link their purchase email and six-character code during signup or on their profile. Email verification and failed signup do not consume codes. Existing accounts can claim purchases too.
- A claim assigns a protected tier and links one purchase to one account. Upgrading to Pro preserves already used boosts; claiming a Member purchase never downgrades Pro.
- Founding Member gets 1 boost per month; Founding Pro gets 3. Allowances reset on the first day of each month at 00:00 UTC with no rollover.
- Each activation promotes an owned active listing for 7 days. Already boosted or sold listings cannot consume another boost. Confirmation appears before spending.
- Recommended browse/search and homepage discovery rank active promotions before pagination. Explicit Newest and price sorting remain unchanged. Category, keyword, and campus filters apply before ranking.
- Database transactions lock the account and listing, enforce quota, and record an idempotent activation. Client retries reuse the same request key until success.
- Open discovery pages refresh at boost expiry, every 30 seconds while visible, on focus, and after changes from another tab. Cards remove expired promotion labels using the database clock snapshot where available.

## Deployment order

1. Back up the existing schema/data and inspect the project's current RLS policies in staging. Migration 0004 was prepared against the configured project's read-only REST schema.
2. Apply `supabase/migrations/0004_founding_boosts.sql` using the Supabase migration workflow or SQL editor, with the usual PostgreSQL migration owner. It is transactional. Do not deploy the dependent app before this succeeds.
3. This migration revokes public/client access to purchase codes, retires the old code-consuming/tier-setting RPCs, and reserves the guest purchase RPC for the service-role webhook. Check other integrations for dependencies on those legacy RPCs.
4. Deploy the application. In staging, test a confirmed purchase through signup and an existing account, badge display, activation, quota exhaustion, and a default/explicitly sorted browse view. The migration has not been applied to the live project by this coding task.
5. Keep the migration's security restrictions when rolling back application code. The old signup redemption flow is retired; do not restore it without fixing account linkage.

## Recovery for previously consumed codes

Rows marked `used = true` without a linked `user_id` cannot be automatically assigned: the old RPC did not record who redeemed them. They receive a recovery message instead of becoming redeemable again. Verify the paid purchase and account ownership through the existing support process, then link the purchase and assign the verified tier using a trusted administrative transaction. Do not reset existing monthly boost usage or infer account ownership from an unverified email. No existing purchases are reopened or reassigned by this migration.

## Validation

- `npm run test:boosts` runs PostgreSQL integration tests in an isolated PGlite database: purchase claims, verification, rate limiting, upgrades, retry safety, quota exhaustion, ownership/status checks, seven-day duration, UTC reset, protected fields, private purchase data, legacy RPC permissions, ranking, filters, and expiry.
- PGlite serializes database requests. The parallel-request test checks queued requests against atomic quota enforcement; a staging PostgreSQL smoke test should additionally exercise independent concurrent connections.
- Changed-file ESLint and TypeScript checks pass. The production Next.js build passes with network access for the project's Google Fonts.
- Authenticated visual and live Stripe-to-account smoke tests still belong to the staging release step; no paid transaction or live data was changed during local validation.
