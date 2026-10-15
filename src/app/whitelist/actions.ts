"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/stripe";
import { isTierKey } from "@/lib/whitelist";
import { ensureAccountProfile } from "@/lib/ensure-account-profile";
import { membershipCheckoutAvailable } from "@/lib/membership-fulfillment";

export async function startCheckout(formData: FormData): Promise<void> {
    const tier = formData.get("tier");
    if (!isTierKey(tier)) {
        redirect("/whitelist?error=invalid_tier");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/whitelist?tier=${tier}`)}`);
    const { error: profileError } = await ensureAccountProfile(supabase, user);
    if (profileError) redirect("/whitelist?error=checkout_failed");
    const { data: profile } = await supabase.from("profiles").select("whitelist_tier").eq("id", user.id).single();
    if (profile?.whitelist_tier === "founding_pro" || profile?.whitelist_tier === tier) redirect("/whitelist?error=already_member");
    if (!await membershipCheckoutAvailable()) redirect("/whitelist?error=checkout_unavailable");

    const { data: spot } = await supabase
        .from("whitelist_spots")
        .select("sold,total")
        .eq("tier", tier)
        .single();

    if (!spot || spot.sold >= spot.total) {
        redirect("/whitelist?error=sold_out");
    }

    let checkoutUrl: string;
    try {
        checkoutUrl = await createCheckoutSession(tier, { id: user.id, email: user.email });
    } catch (err) {
        console.error("[startCheckout]", err);
        redirect("/whitelist?error=checkout_failed");
    }

    redirect(checkoutUrl);
}
