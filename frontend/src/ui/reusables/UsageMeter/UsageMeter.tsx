import { Infinity as InfinityIcon, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import { planLabel, planTone, usageNoun, usageSummary } from '@/helpers/subscription';
import type { Subscription } from '@/types/domain';

/** One pip per allowed quote or request, filled as they are used. Shows an unlimited badge while premium. */
export function UsageMeter({ subscription }: { subscription: Subscription }) {
  const noun = usageNoun(subscription.role);
  if (subscription.limit === null) {
    return <div className="usage-meter unlimited"><span><InfinityIcon size={16} /> Unlimited {noun.many}</span></div>;
  }
  const limit = subscription.limit;
  const used = Math.min(subscription.used, limit);
  return (
    <div className="usage-meter" role="img" aria-label={`${used} of ${limit} ${limit === 1 ? noun.one : noun.many} used`}>
      <div className="usage-meter-head"><span>{subscription.role === 'dealer' ? 'Trial quotes used' : 'Free requests used'}</span><strong>{used} of {limit}</strong></div>
      <div className="usage-meter-pips" aria-hidden="true">
        {Array.from({ length: Math.min(limit, 12) }, (_, index) => <i key={index} className={index < used ? 'on' : ''} style={{ '--i': index } as CSSProperties} />)}
      </div>
    </div>
  );
}

/** Compact plan and usage line for form pages, e.g. "Free plan · 2 of 3 requests left". */
export function UsageChip({ subscription }: { subscription: Subscription }) {
  return <span className={`usage-chip tone-${planTone(subscription)}`}><Sparkles size={13} /> {planLabel(subscription)} · {usageSummary(subscription)}</span>;
}
