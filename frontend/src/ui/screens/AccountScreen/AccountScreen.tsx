import { UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { daysLeft, planBlurb, planCatalog, premiumName, starterState } from '@/helpers/plans';
import type { StarterState } from '@/helpers/plans';
import { formatLongDate } from '@/helpers/dateTime';
import { planLabel, planStatusClass, planTone } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { UsageMeter } from '@/ui/reusables/UsageMeter/UsageMeter';
import { PlanOfferCard, UpgradeLink } from '@/ui/screens/AccountScreen/PlanOfferCard';
import { PlanSkeleton } from '@/ui/screens/AccountScreen/PlanSkeleton';
import type { Subscription } from '@/types/domain';

const starterLabel = (state: StarterState, role: Subscription['role']) => (state === 'current' ? 'Your current plan' : state === 'ended' ? (role === 'dealer' ? 'Trial ended' : 'Limit reached') : 'Not active');

/** Account: the current plan at a glance, and the two plans side by side with a single way to upgrade. */
export default function AccountScreen() {
  const session = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const [refreshing, setRefreshing] = useState(true);

  // Usage and expiry move as the account is used, so refresh whenever this page opens.
  useEffect(() => { void client.auth.me().then(setSession).catch(() => undefined).finally(() => setRefreshing(false)); }, [setSession]);

  if (!session) return null;
  const subscription = session.subscription ?? null;

  return (
    <div className="shell page-content account-page">
      <header className="account-head">
        <div><h1>Account</h1><p>Your current plan and what each plan includes.</p></div>
        <Link className="button button-secondary button-sm" to="/profiles"><UserRound size={16} /> Edit profile</Link>
      </header>
      {subscription ? <AccountBody subscription={subscription} /> : refreshing
        ? <PlanSkeleton label="Loading your plan…" />
        : <section className="card account-unavailable"><h2>Plans aren’t available here</h2><p>We couldn’t load your plan. Refresh the page, or go back to your profile.</p><Link className="button button-secondary" to="/profiles">Back to profile</Link></section>}
    </div>
  );
}

function AccountBody({ subscription }: { subscription: Subscription }) {
  const { starter, premium } = planCatalog(subscription.role, subscription.premiumPrice);
  const tone = planTone(subscription);
  const state = starterState(subscription);
  const remainingDays = daysLeft(subscription);
  const renewing = subscription.isPremium || Boolean(subscription.premiumExpiresAt);
  const premiumEnd = subscription.isPremium && subscription.premiumExpiresAt ? formatLongDate(subscription.premiumExpiresAt) : null;
  const currentName = subscription.isPremium ? premiumName(subscription.role) : planLabel(subscription);

  return (
    <>
      <section className={`card account-summary tone-${tone}`} aria-labelledby="account-plan-title">
        <div className="account-summary-copy">
          <span className="account-summary-label">Current plan</span>
          <div className="account-summary-title"><h2 id="account-plan-title">{currentName}</h2><span className={`status ${planStatusClass[tone]}`}>{tone === 'ended' ? 'Action needed' : 'Active'}</span></div>
          <p>{planBlurb(subscription)}</p>
        </div>
        <div className="account-summary-stats">
          {remainingDays !== null && <div className="account-stat"><strong>{remainingDays}</strong><span>{remainingDays === 1 ? 'day left' : 'days left'}</span></div>}
          <UsageMeter subscription={subscription} />
        </div>
      </section>

      <div className="plan-grid">
        <PlanOfferCard
          offer={starter}
          action={<button type="button" className="button button-secondary button-wide plan-current" disabled>{starterLabel(state, subscription.role)}</button>}
        />
        <PlanOfferCard
          offer={premium}
          featured
          badge={subscription.isPremium ? 'Your plan' : 'Recommended'}
          action={<UpgradeLink label={subscription.isPremium ? 'Renew for another year' : renewing ? 'Renew Premium' : 'Upgrade to Premium'} secondary={subscription.isPremium} />}
          note={premiumEnd ? `Valid until ${premiumEnd}. Renewing adds a full year.` : 'One payment for a full year. No automatic renewal.'}
        />
      </div>
    </>
  );
}
