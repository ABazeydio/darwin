"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BoostResult } from "@/lib/boost-types";
import { getBoostStatus } from "@/lib/boost";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadBoostStatus() {
  return getBoostStatus();
}

export async function boostListing(listingId: string, requestKey: string): Promise<BoostResult> {
  if (typeof listingId !== "string" || typeof requestKey !== "string" || !UUID.test(listingId) || !UUID.test(requestKey)) {
    return { error: "Invalid boost request. Refresh the page and try again." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to boost your listing." };
  const { data, error } = await supabase.rpc("activate_listing_boost", { p_listing_id: listingId, p_request_key: requestKey });
  if (error && ["PGRST202", "42883"].includes(error.code)) return { error: "Boosting is being prepared. Your membership benefits are preserved; please try again shortly." };
  if (error || !data) return { error: "Boost could not be confirmed. Retry to check its status." };
  if (!data.error) {
    revalidatePath("/profile");
    revalidatePath(`/profile/${user.id}`);
    revalidatePath(`/listing/${listingId}`);
    revalidatePath("/browse");
    revalidatePath("/");
  }
  return data as BoostResult;
}
