# Whitelist badges and listing boosts: implementation plan

Implemented in source. See [release notes](founding-boosts-release.md) for migration order, validation, and recovery details.

## Objective
Give purchasers their Founding Member or Founding Pro status on their account and let them spend their monthly allowance to promote their own marketplace listings. Preserve existing tier names, prices, purchase limits, and one-time payment model.

## Findings from the repository
- `src/lib/whitelist.ts` defines 1 boost/month for Founding Member and 3 for Founding Pro.
- `src/lib/boost.ts` reads a quota but has no activation action or database transaction.
- `FoundingBadge` only renders Founding Pro and is currently used as a pricing-page preview, not on profiles.
- Onboarding calls `redeem_magic_code` before signup. The checked-in RPC only marks a purchase used; it does not attach a user or assign a profile tier. Signup failure can consume the code.
- Profile queries do not load whitelist entitlement fields. Listing types do not represent boost expiry.
- The checked-in migrations do not fully describe the existing purchase, listing, or entitlement schema. Inspect the deployed schema and RLS before preparing additive migrations.

## Proposed boost rules
- Each boost promotes one listing for 7 days. This duration is a proposed product default, not an existing promise.
- Founding Member receives 1 boost per calendar month; Founding Pro receives 3. Reset at the first day of each month in UTC, with no rollover.
- Only the authenticated owner can boost an eligible, publicly visible listing. Respect existing sold, deleted, and moderation rules after inspecting the listing schema.
- An already boosted listing cannot consume another boost until its boost expires. Separate listings can be boosted concurrently within the allowance.
- Apply boosts within the selected campus, category, and search filters. On default browse/search ordering, active boosts come first; preserve explicit price sorting. Use stable ordering within each group.
- Expired boosts automatically stop affecting ranking based on database time; expiry must not depend on a scheduled job.
- Display a Boosted label and expiry, without promising views or sales.

## Implementation sequence

### 1. Reliably attach paid membership
- Keep Stripe-confirmed purchases as the source of entitlement; never accept a client-supplied tier.
- Replace pre-signup consumption with an authenticated, atomic purchase claim after a profile exists. Support email verification and existing users through a claim form on their profile.
- Validate purchase email and secret code, attach the purchase to one user, assign the tier, and mark redemption in the same transaction. Repeat claims by the same owner are idempotent; another account cannot reuse the purchase.
- Preserve a higher tier when multiple valid purchases exist. Never reset boost usage when a claim is retried or upgraded.
- Audit existing used purchases. Do not reopen them or infer ownership from an unverified email; provide a controlled recovery path for purchases consumed by the old flow.
- Restrict writes to membership, purchase ownership, quota, and boost fields so ordinary profile/listing updates cannot forge paid status.

### 2. Implement atomic boost activation
- Add verified entitlement/quota fields if absent, an indexed listing boost expiry, and a boost event ledger for audit and retry protection.
- Implement an authenticated database RPC taking a listing ID and request key. Derive the user from the session.
- Lock the profile and listing in a consistent order; verify entitlement, ownership, listing eligibility, expiry, and available quota.
- Reset usage lazily when the UTC month changes. Deduct one allowance and set a 7-day expiry in the same transaction.
- Make retries return the original outcome without spending again. Parallel requests cannot overspend; failed activation consumes nothing.
- Use database time for all allowance and expiry decisions. Return remaining allowance, next reset, and boost expiry.

### 3. Add seller controls and badges
- Add a Founding benefits panel to the private profile: tier badge, remaining monthly boosts, next reset, and purchase-code claim for unlinked buyers.
- Add Boost listing controls to the seller's listing cards and listing management surface. Explain duration and allowance before submission.
- Show pending, success, exhausted allowance, already boosted, and unavailable-listing states; disable repeat submission while pending.
- Render distinct Founding Member and Founding Pro badges on private/public profiles. Carry verified tier data into listing seller rows and listing details.
- Keep founding badges visually distinct from Boosted listing labels.

### 4. Connect discovery ranking
- Include boost expiry and seller tier in the shared listing model and queries.
- Apply ranking before pagination in the database; do not sort only the already fetched client page.
- Keep search/campus/category constraints intact and preserve explicit price ordering.
- Refresh the seller profile, affected listing, and browse results after activation. Handle expiry in cached data and long-open pages so stale results do not stay promoted.

### 5. Validate and release
- Test valid purchase claims, wrong codes, reused codes, signup/verification failures, and upgrade behavior.
- Test nonmembers, wrong owners, ineligible listings, duplicate activation, simultaneous quota use, UTC reset boundaries, and exact expiry boundaries.
- Verify RLS prevents direct entitlement, quota, and expiry manipulation.
- Verify boosts rank before pagination, never cross filters, and disappear from promoted results at expiry; confirm explicit price sorting still works.
- Verify both tier badges on private/public profiles and seller surfaces, including mobile layout.
- Run lint/type checks and integration tests against an isolated database. Deploy the additive migration before dependent application code.

## Completion criteria
A verified buyer can link their purchase without losing it on signup failure, see the correct profile badge, boost an owned eligible listing, see an accurate allowance, and have the listing promoted for exactly the configured duration. Quotas cannot be bypassed or double-spent. Nonmembers retain normal browsing and selling behavior.
