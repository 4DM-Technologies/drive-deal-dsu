import { ArrowRight, Crown } from 'lucide-react';
import type { CSSProperties } from 'react';
import { daysUntil, formatLongDate } from '@/helpers/dateTime';
import { gateCopy, gateReasonFor, PREMIUM_DAYS, usageNoun } from '@/helpers/subscription';
import { UsageMeter } from '@/ui/reusables/UsageMeter/UsageMeter';
import type { Subscription } from '@/types/domain';

const DEFAULT_TRIAL_DAYS = 60;
const DAY = 86_400_000;

interface Identity { name: string; pill: string; tone: 'live' | 'ended' | 'premium'; blurb: string; cta: string }

function identify(subscription: Subscription): Identity {
  const noun = usageNoun(subscription.role);
  const date = (value: string | null) => (value ? formatLongDate(value) : null);
  if (subscription.plan === 'premium') {
    const until = date(subscription.premiumExpiresAt);
    return { name: 'Premium', pill: 'Active', tone: 'premium', cta: 'Renew for another year', blurb: `${until ? `Premium runs until ${until}. ` : ''}Enjoy unlimited ${noun.many} until then. Renewing adds a full year on top.` };
  }
  if (subscription.canCreate) {
    return subscription.role === 'dealer'
      ? { name: 'Free trial', pill: 'Active', tone: 'live', cta: 'Upgrade to Premium', blurb: `${date(subscription.trialExpiresAt) ? `Your trial runs until ${date(subscription.trialExpiresAt)}. ` : ''}It includes up to ${subscription.limit ?? 3} quotes.` }
      : { name: 'Free plan', pill: 'Active', tone: 'live', cta: 'Upgrade to Premium', blurb: `Includes ${subscription.limit ?? 3} car-buy posts for the life of your account.` };
  }
  const reason = gateReasonFor(subscription);
  const copy = gateCopy(reason, subscription.role, subscription.limit);
  const name = subscription.role === 'dealer' ? (subscription.plan === 'trial' ? 'Free trial' : 'Trial ended') : 'Free plan';
  return { name, pill: subscription.plan === 'trial' || subscription.role === 'buyer' ? 'Limit reached' : 'Ended', tone: 'ended', cta: reason === 'premium_expired' ? 'Renew Premium' : 'Upgrade to Premium', blurb: copy.body };
}

/** What the progress ring counts down: days left on a trial or premium year, otherwise the quotes or posts left. */
function ringFor(subscription: Subscription): { value: number; big: string; small: string } {
  const expiry = subscription.plan === 'premium' ? subscription.premiumExpiresAt : subscription.plan === 'trial' && subscription.canCreate ? subscription.trialExpiresAt : null;
  if (expiry) {
    const days = Math.max(daysUntil(expiry), 0);
    const total = subscription.plan === 'premium' ? PREMIUM_DAYS
      : subscription.trialStartedAt ? Math.max(Math.round((new Date(expiry).getTime() - new Date(subscription.trialStartedAt).getTime()) / DAY), 1) : DEFAULT_TRIAL_DAYS;
    return { value: Math.min(100, (days / total) * 100), big: String(days), small: days === 1 ? 'day left' : 'days left' };
  }
  const left = subscription.remaining ?? 0;
  const noun = usageNoun(subscription.role);
  return { value: subscription.limit ? Math.min(100, (left / subscription.limit) * 100) : 0, big: String(left), small: `${noun.many} left` };
}

export function PlanCard({ subscription, onUpgrade }: { subscription: Subscription; onUpgrade: () => void }) {
  const identity = identify(subscription);
  const ring = ringFor(subscription);
  return (
    <section className={`card billing-plan tone-${identity.tone}`} aria-labelledby="billing-plan-title">
      <div className="billing-plan-copy">
        <span className="eyebrow">Current plan</span>
        <div className="billing-plan-title">
          {identity.tone === 'premium' && <span className="billing-crown"><Crown size={18} /></span>}
          <h2 id="billing-plan-title">{identity.name}</h2>
          <span className={`status ${identity.tone === 'live' ? 'status-live' : identity.tone === 'premium' ? 'status-premium' : 'status-declined'}`}>{identity.pill}</span>
        </div>
        <p>{identity.blurb}</p>
        <UsageMeter subscription={subscription} />
        <button type="button" className="button button-primary" onClick={onUpgrade}>{identity.cta} <ArrowRight size={16} /></button>
      </div>
      <div className="billing-ring" style={{ '--ring': ring.value } as CSSProperties} role="img" aria-label={`${ring.big} ${ring.small}`}>
        <div><strong>{ring.big}</strong><span>{ring.small}</span></div>
      </div>
    </section>
  );
}
