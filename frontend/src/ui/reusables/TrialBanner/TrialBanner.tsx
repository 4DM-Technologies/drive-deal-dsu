import { Hourglass, X } from 'lucide-react';
import { useState } from 'react';
import { daysUntil, formatLongDate } from '@/helpers/dateTime';
import { usageNoun, usageSummary } from '@/helpers/subscription';
import type { Subscription } from '@/types/domain';

/**
 * Plan notice for dealers on the free trial. Amber while the trial can still send quotes; red once the trial has ended or
 * its quotes are used up. Hidden for premium dealers and for accounts with no subscription.
 */
export function TrialBanner({ subscription, onUpgrade }: { subscription: Subscription | null; onUpgrade?: () => void }) {
  // Dismissal lives in component state only, so a page reload brings the notice back.
  const [dismissed, setDismissed] = useState(false);
  if (!subscription || subscription.isPremium || subscription.role !== 'dealer' || dismissed) return null;

  const endsAt = subscription.trialExpiresAt;
  const daysLeft = endsAt ? daysUntil(endsAt) : null;
  const ended = subscription.plan === 'free';
  const spent = !ended && !subscription.canCreate;
  const urgent = ended || spent;
  const date = endsAt ? <strong>{formatLongDate(endsAt)}</strong> : null;
  const noun = usageNoun(subscription.role);

  let message;
  if (ended) message = <>Your free trial {date ? <>ended on {date}</> : 'has ended'}. Upgrade to keep sending quotes.</>;
  else if (spent) message = <>You’ve used all {subscription.limit} trial {noun.many}. Upgrade to keep sending quotes.</>;
  else message = <>You’re on a free trial.{date ? <> It expires on {date}{daysLeft !== null && daysLeft > 0 ? <> · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left</> : null}.</> : null} <span className="trial-banner-usage">{usageSummary(subscription)}</span></>;

  return (
    <div className={`trial-banner ${urgent ? 'expired' : ''}`} role="status">
      <Hourglass size={18} />
      <p>{message}{' '}<button type="button" className="trial-banner-link" onClick={onUpgrade}>Click here to upgrade</button></p>
      <button type="button" className="trial-banner-close" aria-label="Dismiss free trial notice" onClick={() => setDismissed(true)}><X size={16} /></button>
    </div>
  );
}
