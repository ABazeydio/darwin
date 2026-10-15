"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FoundingBadge from "@/components/FoundingBadge";
import type { BoostStatus } from "@/lib/boost-types";
import { useMarketplaceRefresh } from "@/lib/use-marketplace-refresh";

export default function FoundingBenefits({ benefits }: { benefits: BoostStatus | null }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useMarketplaceRefresh(refresh);
  return (
    <section className="profile-card">
      <div className="profile-card-header"><h3>Founding benefits</h3><FoundingBadge tier={benefits?.tier} /></div>
      {benefits?.tier ? (
        <div className="flex flex-col gap-2 text-secondary">
          <p><strong className="text-[var(--text-primary)]">{benefits.remaining} of {benefits.quota} boosts</strong> available this month.</p>
          <p className="text-sm">Resets {new Date(benefits.resetAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC. Unused boosts do not roll over.</p>
          <p className="text-sm">Each boost promotes one active listing for 7 days in recommended browse and search results.</p>
          {benefits.tier === 'founding_member' && <Link className="text-sm text-[var(--accent)]" href="/whitelist">Explore Founding Pro</Link>}
        </div>
      ) : <p className="text-secondary">Get a Founding membership for a profile badge and monthly boosts. Your benefits activate automatically after checkout. <Link className="text-[var(--accent)]" href="/whitelist">Explore Founding tiers</Link>.</p>}
      {!benefits && <p role="status" className="text-sm text-secondary mt-3">Benefits are temporarily unavailable. Please try again shortly.</p>}
    </section>
  );
}
