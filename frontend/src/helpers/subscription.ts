import { formatLongDate } from '@/helpers/dateTime';
import { ApiError } from '@/services/platform/apiError';
import type { SubscriptionReason } from '@/services/platform/apiError';
import type { Subscription } from '@/types/domain';

/** Length of one paid Premium term, in days. Mirrors the backend's PREMIUM_DURATION_DAYS. */
export const PREMIUM_DAYS = 365;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
const count = (value: unknown) => (typeof value === 'number' ? value : null);
const reasons: SubscriptionReason[] = ['trial_quota_exhausted', 'trial_expired', 'premium_expired', 'request_limit_reached'];

/** Maps the API's `subscription` block. Dealers report quotes and buyers report requests; both become one usage shape. */
export function parseSubscription(value: unknown): Subscription | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Row;
  if (row.role !== 'dealer' && row.role !== 'buyer') return null;
  const dealer = row.role === 'dealer';
  return {
    role: row.role,
    plan: row.plan === 'premium' || row.plan === 'trial' ? row.plan : 'free',
    isPremium: row.is_premium === true,
    premiumExpiresAt: text(row.premium_expires_at),
    trialStartedAt: text(row.trial_started_at),
    trialExpiresAt: text(row.trial_expires_at),
    premiumPrice: text(row.premium_price) ?? '0.00',
    currency: text(row.currency) ?? 'USD',
    limit: count(dealer ? row.quote_limit : row.request_limit),
    used: count(dealer ? row.quotes_used : row.requests_used) ?? 0,
    remaining: count(dealer ? row.quotes_remaining : row.requests_remaining),
    canCreate: (dealer ? row.can_quote : row.can_create_request) === true,
  };
}

export interface SubscriptionGate { reason: SubscriptionReason | null; used: number | null; limit: number | null }

/** Reads a 402 SUBSCRIPTION_REQUIRED refusal. Returns null for any other error. */
export function subscriptionGate(error: unknown): SubscriptionGate | null {
  if (!(error instanceof ApiError) || error.status !== 402 || error.code !== 'SUBSCRIPTION_REQUIRED') return null;
  const details = error.details ?? {};
  const reason = reasons.find((item) => item === details.reason) ?? null;
  return { reason, used: count(details.used), limit: count(details.limit) };
}

/** The refusal the server would give right now, worked out from the plan so forms can warn before the user submits. */
export function gateReasonFor(subscription: Subscription): SubscriptionReason {
  if (subscription.role === 'buyer') return subscription.premiumExpiresAt ? 'premium_expired' : 'request_limit_reached';
  if (subscription.plan === 'trial') return 'trial_quota_exhausted';
  return subscription.premiumExpiresAt ? 'premium_expired' : 'trial_expired';
}

export type PlanTone = 'premium' | 'live' | 'ended';

/** Colour family for a plan: premium, active (can still create), or ended (needs an upgrade). */
export const planTone = (subscription: Subscription): PlanTone => (subscription.plan === 'premium' ? 'premium' : subscription.canCreate ? 'live' : 'ended');

/** The `.status` pill modifier for each tone. */
export const planStatusClass: Record<PlanTone, string> = { premium: 'status-premium', live: 'status-live', ended: 'status-declined' };

/** The posting gate Sera attaches to a request preview (`posting_allowed` / `posting_reason`). */
export function postingGate(payload: unknown): { allowed: boolean; reason: SubscriptionReason | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Row;
  if (typeof row.posting_allowed !== 'boolean') return null;
  return { allowed: row.posting_allowed, reason: reasons.find((item) => item === row.posting_reason) ?? null };
}

/** The term line for a checkout: a fresh year from payment, or the year a renewal adds on top of the current plan. */
export function premiumTerm(subscription: Subscription): string {
  if (!(subscription.isPremium && subscription.premiumExpiresAt)) return '1 year from payment';
  const until = new Date(new Date(subscription.premiumExpiresAt).getTime() + PREMIUM_DAYS * 86_400_000).toISOString();
  return `+1 year · to ${formatLongDate(until)}`;
}

export const usageNoun = (role: Subscription['role']) => (role === 'dealer' ? { one: 'quote', many: 'quotes' } : { one: 'request', many: 'requests' });

export function planLabel(subscription: Subscription | null | undefined): string {
  if (!subscription) return 'Free';
  if (subscription.plan === 'premium') return 'Premium';
  if (subscription.plan === 'trial') return 'Free trial';
  return subscription.role === 'dealer' ? 'Trial ended' : 'Free plan';
}

/** "2 of 3 quotes left", or "Unlimited quotes" while premium. */
export function usageSummary(subscription: Subscription): string {
  const noun = usageNoun(subscription.role);
  if (subscription.limit === null) return `Unlimited ${noun.many}`;
  const left = subscription.remaining ?? Math.max(subscription.limit - subscription.used, 0);
  return `${left} of ${subscription.limit} ${subscription.limit === 1 ? noun.one : noun.many} left`;
}

export function gateCopy(reason: SubscriptionReason | null, role: Subscription['role'], limit: number | null = null): { title: string; body: string } {
  const noun = usageNoun(role);
  const keep = `Your existing ${role === 'dealer' ? 'quotes and deals' : 'requests'} stay visible.`;
  switch (reason) {
    case 'request_limit_reached':
      return { title: `You’ve used your ${limit ?? 3} free requests`, body: `Upgrade to Premium to publish more car-buy requests. ${keep}` };
    case 'trial_quota_exhausted':
      return { title: `You’ve used all ${limit ?? 3} trial ${noun.many}`, body: `Upgrade to Premium to keep sending quotes. ${keep}` };
    case 'trial_expired':
      return { title: 'Your free trial has ended', body: `Upgrade to Premium to send new quotes. ${keep}` };
    case 'premium_expired':
      return { title: 'Your Premium plan has expired', body: `Renew to ${role === 'dealer' ? 'send new quotes' : 'publish new requests'}. ${keep}` };
    default:
      return { title: 'Upgrade to continue', body: `Premium unlocks this. ${keep}` };
  }
}
