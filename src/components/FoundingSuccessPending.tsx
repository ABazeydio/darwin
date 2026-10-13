"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Toast from "@/components/Toast";
import FoundingBadge from "@/components/FoundingBadge";
import { isTierKey } from "@/lib/whitelist";
import { announceMarketplaceChange } from "@/lib/use-marketplace-refresh";

export default function FoundingSuccessPending({ sessionId, initiallyReady = false, tier }: { sessionId: string; initiallyReady?: boolean; tier?: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(initiallyReady);
  const [toast, setToast] = useState(initiallyReady);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const closeToast = useCallback(() => setToast(false), []);
  useEffect(() => {
    if (initiallyReady) { announceMarketplaceChange(); return; }
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (stopped) return;
      attempts++;
      try {
        const res = await fetch('/api/founding/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
        const data = await res.json();
        if (stopped) return;
        if (res.ok && data.status === 'fulfilled') {
          setReady(true); setToast(true); announceMarketplaceChange(); router.refresh(); return;
        }
        if (data.status === 'sold_out' || data.status === 'already_member') {
          setMessage(data.status === 'sold_out' ? 'This tier sold out before payment completed. Your payment has been refunded.' : 'This membership is already active. Your duplicate payment has been refunded.'); return;
        }
        if (res.status === 401 || res.status === 403) { setMessage('Sign in to the account used for checkout to view your membership.'); return; }
      } catch { /* Transient failures are retried without another charge. */ }
      if (stopped) return;
      if (attempts >= 20) { setFailed(true); return; }
      timer = setTimeout(() => { void poll(); }, 1500);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sessionId, initiallyReady, router]);
  return (
    <div className="flex flex-col gap-3">
      {ready ? <><FoundingBadge tier={isTierKey(tier) ? tier : null} /><p role="status" className="waitlist-founding-copy">Your membership is active. Your profile badge and monthly benefits have been applied automatically.</p></> : <p role="status" className="waitlist-founding-copy text-secondary">{message || (failed ? 'Your checkout is still being confirmed. Refresh shortly to check activation.' : 'Confirming your payment and activating your membership…')}</p>}
      <Toast visible={toast} type="success" message="Membership activated! Your badge and benefits are ready." onClose={closeToast} />
    </div>
  );
}
