import "server-only";
import { retrieveSession, refundSession } from "@/lib/stripe";
import { serviceClient } from "@/lib/supabase/service";
import { paidMembershipIdentity } from "@/lib/membership-validation";
import { TIERS } from "@/lib/whitelist";
import { revalidatePath } from "next/cache";

export type MembershipFulfillment = { status: "fulfilled" | "pending" | "sold_out" | "already_member" | "invalid"; tier?: string };

/** Do not accept new payments before automatic fulfillment is deployed. */
export async function membershipCheckoutAvailable(): Promise<boolean> {
  try {
    const { error } = await serviceClient().from("paid_membership_checkouts").select("session_id").limit(0);
    return !error;
  } catch { return false; }
}

/** The webhook and checkout return share one idempotent fulfillment path. */
export async function fulfillMembership(sessionId: string, expectedUserId?: string, refresh = true): Promise<MembershipFulfillment> {
  const session = await retrieveSession(sessionId);
  if (expectedUserId && session.metadata?.user_id !== expectedUserId) return { status: "invalid" };
  if (session.payment_status !== "paid") return { status: "pending" };
  const prices = {
    founding_member: process.env[TIERS.founding_member.priceEnv],
    founding_pro: process.env[TIERS.founding_pro.priceEnv],
  };
  const identity = paidMembershipIdentity(session, prices);
  const supabase = serviceClient();
  if (!identity) {
    // A refunded duplicate/sold-out payment stays a completed rejection on
    // webhook or page retries; it must never grant a refunded membership.
    const refunded = paidMembershipIdentity(session, prices, true);
    if (refunded) {
      const { data } = await supabase.from("paid_membership_checkouts").select("status,tier")
        .eq("session_id", session.id).eq("user_id", refunded.userId).eq("tier", refunded.tier).maybeSingle();
      if (data && (data.status === "sold_out" || data.status === "already_member")) return data as MembershipFulfillment;
    }
    return { status: "invalid" };
  }
  const { data, error } = await supabase.rpc("fulfill_paid_membership", {
    p_session_id: session.id, p_user_id: identity.userId, p_tier: identity.tier,
  });
  if (error || !data) throw new Error("Paid membership fulfillment is unavailable");
  const result = data as MembershipFulfillment;
  if (result.status === "sold_out" || result.status === "already_member") {
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!intentId) throw new Error("Refund payment reference is missing");
    await refundSession(intentId, `membership-refund-${session.id}`);
  }
  if (refresh && result.status === "fulfilled") {
    revalidatePath("/profile");
    revalidatePath(`/profile/${identity.userId}`);
    revalidatePath("/whitelist");
    revalidatePath("/browse");
    revalidatePath("/");
  }
  return result;
}
