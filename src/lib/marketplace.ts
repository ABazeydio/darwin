import type { Category, Condition, Listing } from "@/lib/data";
import { isTierKey } from "@/lib/whitelist";

export type MarketplaceRow = {
  listing: {
    id: string; title: string; description: string | null; price: number;
    category: Category | null; condition: Condition | null; campus: string | null;
    image_url: string | null; created_at: string; boosted_until: string | null;
    seller: { id: string; first_name: string | null; full_name: string | null; avatar_url: string | null; whitelist_tier: string | null };
  };
  total_count: number;
  server_now: string;
};

export function mapMarketplaceListing(row: MarketplaceRow, savedIds: Set<string> = new Set()): Listing {
  const item = row.listing;
  return {
    id: item.id, title: item.title, price: item.price,
    description: item.description ?? "", category: item.category ?? "Other", condition: item.condition ?? "New",
    image: item.image_url || "/images/textbook.svg", createdAt: item.created_at,
    boostedUntil: item.boosted_until, serverNow: row.server_now, saved: savedIds.has(item.id),
    seller: {
      id: item.seller.id, name: item.seller.full_name || item.seller.first_name || "Student",
      avatar: item.seller.avatar_url || "/avatars/1.jpg", campus: item.campus || "Main Campus",
      tier: isTierKey(item.seller.whitelist_tier) ? item.seller.whitelist_tier : null,
    },
  };
}
