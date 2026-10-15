# Launch updates: October 12, 2026

## Listing visibility

The configured live database had four public listings but did not expose `browse_marketplace` or the `boosted_until` listing column. Queries introduced for the pending boost migration therefore failed. The shared listing loader now falls back to the existing listings table only on missing-schema errors, preserving active-only filtering, campus/category/search filters, explicit sort order, and pagination. Permission and connection failures still surface as errors. Profile, saved, and detail queries tolerate an absent boost field.

The fixed public loader was verified read-only against the configured live project: four visible rows, one price-sorted row with a total of four, and no rows for an unmatched search. No live database writes were performed.

## Listing price

The price input has separate dollar/amount/CAD elements, a decimal keypad, two-decimal formatting on blur, and a buyer-facing formatted preview. It accepts pasted dollar amounts and shorthand decimals. Client and server validation reject negative/zero amounts, excess decimal precision, scientific notation, and unsafe monetary values.

## Automatic membership activation

New purchases require sign-in. Checkout carries a server-derived account ID in metadata and `client_reference_id`. Signup and profiles no longer ask for purchase emails or magic codes.

The webhook and authenticated checkout-return flow share one fulfillment routine. It verifies Stripe's paid session, completion, configured price, quantity, account identity, and refund state. A service-only database transaction records the checkout, reserves one tier spot, and assigns the profile tier while preserving boost usage on upgrades. Retries cannot reserve twice; duplicate memberships and sold-out payments are refunded with a stable Stripe idempotency key. Delayed payment success events are supported.

The success page displays the automatic activation result and a success toast after fulfillment. Its authenticated status endpoint no longer exposes purchase emails or codes. Legacy guest webhooks and existing magic-code source artifacts remain available for review.

## Database review boundary and deployment

No live schema or data was changed. Existing magic-code/guest purchase tables, functions, data, and grants remain untouched. Migration `0004_founding_boosts.sql` is unchanged and remains under review; **do not run a blanket migration push that applies it while reviewing those legacy changes**.

The new standalone `0005_paid_membership_fulfillment.sql` creates only a private checkout ledger and a service-only fulfillment function. It uses existing profile and tier-inventory fields; it does not modify legacy magic-code systems. Review/apply this standalone migration before enabling the new checkout flow. Checkout safely remains unavailable if the new fulfillment ledger is absent. Boost activation still depends on the separate boost migration under review; listing visibility and existing badges do not.

Test the complete signed-in purchase in Stripe test mode after applying the standalone migration in staging. No real payment was submitted during this coding task.

## Validation

`npm run test:launch` covers prices, payment identity/price/refund validation, missing-RPC compatibility, permission errors, idempotent fulfillment, sold-out handling, upgrade allowance preservation, and unchanged legacy code data/permissions. The existing `npm run test:boosts` suite still passes. Changed-file ESLint, TypeScript, and the production build pass.
