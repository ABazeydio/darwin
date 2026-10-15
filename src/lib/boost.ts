import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BoostStatus } from "@/lib/boost-types";
import { isTierKey, TIERS } from "@/lib/whitelist";

/** Database time and the authenticated account determine quota/reset status. */
export async function getBoostStatus(): Promise<BoostStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("founding_boost_status");
  if (error && ["PGRST202", "42883"].includes(error.code)) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("whitelist_tier, boosts_used_this_month, boost_reset_at").eq("id", user.id).maybeSingle();
    if (profileError || !profile) return null;
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const tier = isTierKey(profile.whitelist_tier) ? profile.whitelist_tier : null;
    const quota = tier ? TIERS[tier].boostsPerMonth : 0;
    const used = profile.boost_reset_at && new Date(profile.boost_reset_at).getTime() > now.getTime() ? profile.boosts_used_this_month ?? 0 : 0;
    return { tier, quota, remaining: Math.max(0, quota - used), resetAt: resetAt.toISOString(), serverNow: now.toISOString() };
  }
  if (error || !data || data.error) return null;
  return data as BoostStatus;
}
