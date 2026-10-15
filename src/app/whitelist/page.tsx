import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { startCheckout } from "./actions";
import { TIERS, isTierKey, type TierKey } from "@/lib/whitelist";
import WhitelistFeedback from "@/components/WhitelistFeedback";
import WhitelistClient from "./WhitelistClient";

export const dynamic = "force-dynamic";

type SpotRow = { tier: string; sold: number; total: number };

async function fetchSpots(): Promise<Record<TierKey, SpotRow>> {
    const supabase = await createClient();
    const { data } = await supabase
        .from("whitelist_spots")
        .select("tier,sold,total");

    const rows = (data ?? []) as SpotRow[];
    const byTier = Object.fromEntries(rows.map((r) => [r.tier, r])) as Record<
        string,
        SpotRow
    >;

    return {
        founding_member: byTier.founding_member ?? {
            tier: "founding_member",
            sold: 0,
            total: TIERS.founding_member.maxSpots,
        },
        founding_pro: byTier.founding_pro ?? {
            tier: "founding_pro",
            sold: 0,
            total: TIERS.founding_pro.maxSpots,
        },
    };
}

export default async function WhitelistPage({
    searchParams,
}: {
    searchParams: Promise<{ tier?: string }>;
}) {
    const spots = await fetchSpots();

    const { tier } = await searchParams;
    if (isTierKey(tier)) {
        const form = new FormData();
        form.set("tier", tier);
        await startCheckout(form);
    }

    return (
        <>
            <Suspense>
                <WhitelistFeedback />
            </Suspense>
            <WhitelistClient spots={spots} />
        </>
    );
}
