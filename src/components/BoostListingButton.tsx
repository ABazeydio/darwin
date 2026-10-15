"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { boostListing } from "@/app/profile/founding-actions";
import { isBoostActive, type BoostStatus } from "@/lib/boost-types";
import { announceMarketplaceChange, useBoostClock } from "@/lib/use-marketplace-refresh";

type Props = { listingId: string; boostedUntil?: string | null; status?: string; benefits?: BoostStatus | null };

export default function BoostListingButton({ listingId, boostedUntil, status = "active", benefits }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [activatedUntil, setActivatedUntil] = useState<string>();
  const requestKey = useRef<string | null>(null);
  const now = useBoostClock(benefits?.serverNow);
  const expiry = activatedUntil ?? boostedUntil;
  const active = isBoostActive(expiry, now);
  const exhausted = !!benefits?.tier && benefits.remaining === 0 && new Date(benefits.resetAt).getTime() > now;
  const unavailable = status !== "active" || (benefits !== undefined && !benefits?.tier);

  async function activate() {
    if (pending) return;
    setPending(true);
    requestKey.current ??= crypto.randomUUID();
    try {
      const result = await boostListing(listingId, requestKey.current);
      if ("error" in result) setFeedback(result.error);
      else {
        setActivatedUntil(result.boostedUntil);
        requestKey.current = null;
        setConfirming(false);
        setFeedback("Your listing is boosted for 7 days.");
        announceMarketplaceChange();
        router.refresh();
      }
    } catch { setFeedback("Connection interrupted. Retry to confirm your boost without spending twice."); }
    finally { setPending(false); }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {active ? <p className="text-sm text-[var(--accent)]">Boosted until {new Date(expiry!).toLocaleString()}</p> : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-secondary">Use 1 monthly boost to promote this listing for 7 days?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pill-btn pill-btn-sm" disabled={pending} onClick={activate}>{pending ? "Boosting…" : "Confirm boost"}</button>
            <button type="button" className="pill-btn pill-btn-outline pill-btn-sm" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="pill-btn pill-btn-outline pill-btn-sm ui-icon-label" disabled={pending || exhausted || unavailable} onClick={() => { setFeedback(""); setConfirming(true); }}>
          <Rocket size={14} />{unavailable ? status !== "active" ? "Listing unavailable" : "Founding membership required" : exhausted ? "No boosts left this month" : "Boost listing"}
        </button>
      )}
      {feedback && <p role="status" className="text-sm text-secondary">{feedback}</p>}
    </div>
  );
}
