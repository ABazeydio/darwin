import type Stripe from "stripe";
import type { TierKey } from "@/lib/whitelist";

/** Accept only paid, account-bound Checkout Sessions for configured prices. */
export function paidMembershipIdentity(session: Stripe.Checkout.Session, prices: Record<TierKey, string | undefined>, allowRefunded = false) {
  const tier = session.metadata?.tier;
  const userId = session.metadata?.user_id;
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.status !== "complete"
    || session.metadata?.fulfillment_version !== "account_v1"
    || (tier !== "founding_member" && tier !== "founding_pro")
    || !userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    || session.client_reference_id !== userId) return null;
  const items = session.line_items;
  if (!prices[tier] || !items || items.has_more || items.data.length !== 1
    || items.data[0].quantity !== 1 || items.data[0].price?.id !== prices[tier]) return null;
  const intent = session.payment_intent;
  if (intent && typeof intent !== "string") {
    const charge = intent.latest_charge;
    if (!allowRefunded && charge && typeof charge !== "string" && (charge.refunded || charge.amount_refunded > 0)) return null;
  }
  return { userId, tier };
}
