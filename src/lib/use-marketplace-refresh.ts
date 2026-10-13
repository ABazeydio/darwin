"use client";

import { useEffect, useState } from "react";

export function announceMarketplaceChange() {
  window.dispatchEvent(new Event("marketplace-changed"));
  try { localStorage.setItem("marketplace-changed", String(Date.now())); } catch { /* Storage may be disabled. */ }
}

/** Refresh promotion/quota boundaries on long-open pages and across tabs. */
export function useMarketplaceRefresh(refresh: () => void, nextExpiry?: string | null, serverNow?: string) {
  useEffect(() => {
    const visibleRefresh = () => { if (document.visibilityState === "visible") refresh(); };
    const storageRefresh = (event: StorageEvent) => { if (event.key === "marketplace-changed") visibleRefresh(); };
    const timer = window.setInterval(visibleRefresh, 30_000);
    const untilExpiry = nextExpiry && serverNow ? new Date(nextExpiry).getTime() - new Date(serverNow).getTime() : 0;
    const expiryTimer = untilExpiry > 0 ? window.setTimeout(visibleRefresh, Math.min(untilExpiry + 50, 2_147_483_647)) : undefined;
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("marketplace-changed", visibleRefresh);
    window.addEventListener("storage", storageRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(expiryTimer);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("marketplace-changed", visibleRefresh);
      window.removeEventListener("storage", storageRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, nextExpiry, serverNow]);
}

export function earliestBoostExpiry(listings: { boostedUntil?: string | null; serverNow?: string }[]) {
  return listings.map((listing) => listing.boostedUntil)
    .filter((expiry): expiry is string => !!expiry && !!listings[0]?.serverNow && new Date(expiry).getTime() > new Date(listings[0].serverNow).getTime())
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

export function useBoostClock(serverNow?: string) {
  const [sample, setSample] = useState(() => ({ source: serverNow, now: serverNow ? new Date(serverNow).getTime() : Date.now() }));
  useEffect(() => {
    const start = performance.now();
    const base = serverNow ? new Date(serverNow).getTime() : Date.now();
    const timer = window.setInterval(() => setSample({ source: serverNow, now: base + performance.now() - start }), 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return sample.source === serverNow ? sample.now : serverNow ? new Date(serverNow).getTime() : sample.now;
}
