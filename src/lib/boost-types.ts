import type { TierKey } from "@/lib/whitelist";

export type BoostStatus = {
  tier: TierKey | null;
  quota: number;
  remaining: number;
  resetAt: string;
  serverNow: string;
};
export type BoostResult = (BoostStatus & { boostedUntil?: string }) | { error: string };
export function isBoostActive(expiry: string | null | undefined, now: number): boolean {
  return !!expiry && new Date(expiry).getTime() > now;
}
