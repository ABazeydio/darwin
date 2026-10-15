import { Sparkles, Star } from 'lucide-react';
import { TIERS, isTierKey, type TierKey } from '@/lib/whitelist';

type FoundingBadgeProps = {
  tier: TierKey | null | undefined;
};

/** Paid status is loaded from the protected profile entitlement. */
export default function FoundingBadge({ tier }: FoundingBadgeProps) {
  if (!isTierKey(tier)) return null;
  const Icon = tier === 'founding_pro' ? Star : Sparkles;

  return (
    <span className="founding-badge" aria-label={`${TIERS[tier].label} member`}>
      <Icon size={11} fill={tier === 'founding_pro' ? 'currentColor' : 'none'} />
      {TIERS[tier].label}
    </span>
  );
}
