import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceRow } from "./marketplace";

type Options = { query?: string; category?: string | null; campus?: string | null; sort?: string; limit?: number; offset?: number };

/** Older deployments can browse while the boost migration remains under review. */
export async function fetchMarketplace(supabase: SupabaseClient, options: Options = {}) {
  const { query = "", category = null, campus = null, sort = "recommended", limit = 24, offset = 0 } = options;
  const result = await supabase.rpc("browse_marketplace", { p_query: query.trim(), p_category: category, p_campus: campus, p_sort: sort, p_limit: limit, p_offset: offset });
  if (!result.error) return { ...result, data: result.data as MarketplaceRow[] };
  // Only missing-schema errors permit fallback; permissions and outages must surface.
  if (!["PGRST202", "42883", "42703"].includes(result.error.code)) return { ...result, data: null };
  let request = supabase.from("listings").select("*, seller:profiles(id, first_name, full_name, avatar_url, whitelist_tier)", { count: "exact" }).eq("status", "active");
  if (category) request = request.eq("category", category);
  if (campus) request = request.eq("campus", campus);
  if (query.trim()) {
    // PostgREST filter syntax needs quoted values; treat wildcard characters literally.
    const escaped = query.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/"/g, '\\"');
    request = request.or(`title.ilike."%${escaped}%",description.ilike."%${escaped}%"`);
  }
  if (sort === "price-low" || sort === "price-high") request = request.order("price", { ascending: sort === "price-low" });
  const legacy = await request.order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + limit - 1);
  if (legacy.error) return { ...legacy, data: null };
  const data: MarketplaceRow[] = (legacy.data ?? []).flatMap((item) => {
    const seller = Array.isArray(item.seller) ? item.seller[0] : item.seller;
    return seller ? [{ listing: { ...item, seller, boosted_until: item.boosted_until ?? null } as MarketplaceRow["listing"], total_count: legacy.count ?? 0, server_now: new Date().toISOString() }] : [];
  });
  return { ...legacy, data };
}
