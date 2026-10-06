import { formatMoney } from '@/helpers/currency';
import { daysUntil, formatLongDate } from '@/helpers/dateTime';
import { gateCopy, gateReasonFor, usageNoun } from '@/helpers/subscription';
import type { Subscription } from '@/types/domain';

export interface PlanOffer {
  id: 'starter' | 'premium';
  name: string;
  tagline: string;
  /** Price as shown big, e.g. "$500". */
  price: string;
  /** What the price covers, e.g. "per year". */
  period: string;
  /** Lead-in above the feature list. */
  lead: string;
  features: string[];
}

export interface PlanCatalog { starter: PlanOffer; premium: PlanOffer }

/** The name of the paid tier, e.g. "Premium dealer". */
export const premiumName = (role: Subscription['role']) => (role === 'dealer' ? 'Premium dealer' : 'Premium');

/** The two plans shown on the Account page. Wording follows the backend rules: dealers get a 2-month trial with 3 quotes, buyers get 3 requests. */
export function planCatalog(role: Subscription['role'], premiumPrice: string): PlanCatalog {
  const price = formatMoney(premiumPrice);
  if (role === 'dealer') {
    return {
      starter: {
        id: 'starter', name: 'Free trial', tagline: 'Try Deal&Drive for two months.', price: '$0', period: 'for 2 months', lead: 'Start with the basics:',
        features: ['2 months of access from your first sign-in', 'Up to 3 quotes in total', 'Browse the live buyer feed', 'Message buyers about your quotes', 'Basic dealer profile'],
      },
      premium: {
        id: 'premium', name: premiumName('dealer'), tagline: 'For dealers who quote every week.', price, period: 'per year', lead: 'Everything in the free trial, and:',
        features: ['Unlimited quotes', 'Valid for one full year', 'Renew any time, each renewal adds a year'],
      },
    };
  }
  return {
    starter: {
      id: 'starter', name: 'Free', tagline: 'See how Deal&Drive works.', price: '$0', period: 'no time limit', lead: 'Start with the basics:',
      features: ['Up to 3 car-buy requests in total', 'No new requests after the third one', 'Receive and compare dealer quotes', 'Limited Sera AI features'],
    },
    premium: {
      id: 'premium', name: premiumName('buyer'), tagline: 'For buyers who want every option open.', price, period: 'per year', lead: 'Everything in Free, and:',
      features: ['Unlimited car-buy requests', 'Unlimited access to Sera, your AI advisor', 'Valid for one full year', 'Renew any time, each renewal adds a year'],
    },
  };
}

/** Which state the free or trial card is in, given the live subscription. */
export type StarterState = 'current' | 'ended' | 'inactive';

export function starterState(subscription: Subscription): StarterState {
  if (subscription.plan === 'premium') return 'inactive';
  return subscription.canCreate ? 'current' : 'ended';
}

/** The detail line that sits beside the plan name: what is left, or when Premium ends. */
export function planDetailLine(subscription: Subscription): string {
  const noun = usageNoun(subscription.role);
  if (subscription.plan === 'premium') return subscription.premiumExpiresAt ? `Valid until ${formatLongDate(subscription.premiumExpiresAt)}` : 'Active';
  if (subscription.canCreate) return `${subscription.remaining ?? 0} of ${subscription.limit ?? 3} ${noun.many} left`;
  if (subscription.role === 'dealer' && subscription.plan !== 'trial') return 'Trial period is over';
  return `All ${subscription.limit ?? 3} ${noun.many} used`;
}

/** Whole days left on the running trial or Premium year, or null on a plan with no end date. */
export function daysLeft(subscription: Subscription): number | null {
  const expiry = subscription.plan === 'premium' ? subscription.premiumExpiresAt : subscription.plan === 'trial' ? subscription.trialExpiresAt : null;
  return expiry ? Math.max(daysUntil(expiry), 0) : null;
}

/** A sentence or two describing the current plan on the Account page. */
export function planBlurb(subscription: Subscription): string {
  const noun = usageNoun(subscription.role);
  const until = (value: string | null) => (value ? formatLongDate(value) : null);
  if (subscription.plan === 'premium') {
    const end = until(subscription.premiumExpiresAt);
    return `${end ? `Premium runs until ${end}. ` : ''}You have unlimited ${noun.many} until then. Renewing adds a full year on top.`;
  }
  if (subscription.canCreate) {
    if (subscription.role === 'buyer') return `Your free plan includes ${subscription.limit ?? 3} car-buy requests in total.`;
    const end = until(subscription.trialExpiresAt);
    return `${end ? `Your trial runs until ${end}. ` : ''}It includes up to ${subscription.limit ?? 3} quotes in total.`;
  }
  return gateCopy(gateReasonFor(subscription), subscription.role, subscription.limit).body;
}

/** Short reason shown on the menu's upgrade row. */
export function upgradeHint(subscription: Subscription): string {
  const noun = usageNoun(subscription.role);
  if (subscription.plan === 'premium') return 'Renew to add another year';
  if (!subscription.canCreate) return subscription.role === 'dealer' ? 'Your trial is over. Upgrade to keep quoting.' : 'Free requests used. Upgrade to post more.';
  return `Unlimited ${noun.many} for ${formatMoney(subscription.premiumPrice)} a year`;
}
