import { describe, expect, it } from 'vitest';

import { gateCopy, gateReasonFor, parseSubscription, planLabel, planTone, postingGate, premiumTerm, subscriptionGate, usageSummary } from '@/helpers/subscription';
import { ApiError } from '@/services/platform/apiError';

const dealerTrial = {
  role: 'dealer', plan: 'trial', is_premium: false, premium_expires_at: null,
  trial_started_at: '2026-10-06T13:02:42+00:00', trial_expires_at: '2026-12-05T13:02:42+00:00',
  premium_price: '500.00', currency: 'USD', quote_limit: 3, quotes_used: 1, quotes_remaining: 2, can_quote: true,
};
const buyerFree = {
  role: 'buyer', plan: 'free', is_premium: false, premium_expires_at: null, trial_started_at: null, trial_expires_at: null,
  premium_price: '100.00', currency: 'USD', request_limit: 3, requests_used: 3, requests_remaining: 0, can_create_request: false, ai_posting_allowed: false,
};

describe('parseSubscription', () => {
  it('folds dealer quote fields into the shared usage shape', () => {
    expect(parseSubscription(dealerTrial)).toEqual({
      role: 'dealer', plan: 'trial', isPremium: false, premiumExpiresAt: null,
      trialStartedAt: '2026-10-06T13:02:42+00:00', trialExpiresAt: '2026-12-05T13:02:42+00:00',
      premiumPrice: '500.00', currency: 'USD', limit: 3, used: 1, remaining: 2, canCreate: true,
    });
  });

  it('folds buyer post fields into the same shape', () => {
    expect(parseSubscription(buyerFree)).toMatchObject({ role: 'buyer', plan: 'free', limit: 3, used: 3, remaining: 0, canCreate: false, premiumPrice: '100.00' });
  });

  it('treats null limits as unlimited while premium', () => {
    const premium = parseSubscription({ ...dealerTrial, plan: 'premium', is_premium: true, premium_expires_at: '2027-10-06T13:02:42+00:00', quote_limit: null, quotes_remaining: null });
    expect(premium).toMatchObject({ isPremium: true, limit: null, remaining: null, canCreate: true });
    expect(usageSummary(premium!)).toBe('Unlimited quotes');
  });

  it('returns null for staff, which have no subscription block', () => {
    expect(parseSubscription(undefined)).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription({ role: 'support' })).toBeNull();
  });
});

describe('plan wording', () => {
  it('labels each plan for both roles', () => {
    expect(planLabel(parseSubscription(dealerTrial))).toBe('Free trial');
    expect(planLabel(parseSubscription({ ...dealerTrial, plan: 'free', can_quote: false }))).toBe('Trial ended');
    expect(planLabel(parseSubscription(buyerFree))).toBe('Free plan');
    expect(planLabel(parseSubscription({ ...buyerFree, plan: 'premium', is_premium: true }))).toBe('Premium');
  });

  it('summarises what is left', () => {
    expect(usageSummary(parseSubscription(dealerTrial)!)).toBe('2 of 3 quotes left');
    expect(usageSummary(parseSubscription(buyerFree)!)).toBe('0 of 3 posts left');
  });
});

describe('subscription gating', () => {
  const refusal = (reason: string) => ApiError.fromResponse(402, { error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Subscribe', details: { reason, plan: 'free', used: 3, limit: 3 }, request_id: 'r-1' } });

  it('reads a 402 refusal by code and reason, not message', () => {
    expect(subscriptionGate(refusal('request_limit_reached'))).toEqual({ reason: 'request_limit_reached', used: 3, limit: 3 });
    expect(subscriptionGate(refusal('something_new'))).toEqual({ reason: null, used: 3, limit: 3 });
  });

  it('ignores every other error', () => {
    expect(subscriptionGate(new Error('nope'))).toBeNull();
    expect(subscriptionGate(ApiError.fromResponse(403, { error: { code: 'FORBIDDEN_ROLE', message: 'No' } }))).toBeNull();
    expect(subscriptionGate(ApiError.fromResponse(402, { error: { code: 'OTHER', message: 'No' } }))).toBeNull();
  });

  it('predicts the refusal from the plan', () => {
    expect(gateReasonFor(parseSubscription(buyerFree)!)).toBe('request_limit_reached');
    expect(gateReasonFor(parseSubscription({ ...dealerTrial, quotes_used: 3, quotes_remaining: 0, can_quote: false })!)).toBe('trial_quota_exhausted');
    expect(gateReasonFor(parseSubscription({ ...dealerTrial, plan: 'free', can_quote: false })!)).toBe('trial_expired');
    expect(gateReasonFor(parseSubscription({ ...dealerTrial, plan: 'free', can_quote: false, premium_expires_at: '2026-01-01T00:00:00+00:00' })!)).toBe('premium_expired');
  });

  it('writes plain-language copy for each reason', () => {
    expect(gateCopy('request_limit_reached', 'buyer', 3).title).toBe('You’ve used your 3 free posts');
    expect(gateCopy('trial_quota_exhausted', 'dealer', 3).title).toBe('You’ve used all 3 trial quotes');
    expect(gateCopy('trial_expired', 'dealer').body).toContain('stay visible');
  });
});

describe('premiumTerm', () => {
  it('describes a first purchase and a renewal', () => {
    expect(premiumTerm(parseSubscription(dealerTrial)!)).toBe('1 year from payment');
    const renewing = parseSubscription({ ...dealerTrial, plan: 'premium', is_premium: true, premium_expires_at: '2027-10-06T14:26:42+00:00' })!;
    expect(premiumTerm(renewing)).toMatch(/^\+1 year · to October [56], 2028$/);
  });
});

describe('plan tone and Sera posting gate', () => {
  it('groups plans into premium, live and ended', () => {
    expect(planTone(parseSubscription(dealerTrial)!)).toBe('live');
    expect(planTone(parseSubscription({ ...dealerTrial, plan: 'premium', is_premium: true })!)).toBe('premium');
    expect(planTone(parseSubscription(buyerFree)!)).toBe('ended');
  });

  it('reads the gate Sera attaches to a request preview', () => {
    expect(postingGate({ model: 'X3', posting_allowed: false, posting_reason: 'request_limit_reached' })).toEqual({ allowed: false, reason: 'request_limit_reached' });
    expect(postingGate({ posting_allowed: true, posting_reason: null })).toEqual({ allowed: true, reason: null });
    expect(postingGate({ model: 'X3' })).toBeNull();
    expect(postingGate(null)).toBeNull();
  });
});

describe('ApiError', () => {
  it('keeps the envelope fields and falls back safely', () => {
    const error = ApiError.fromResponse(402, { error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Subscribe', details: { used: 3 }, request_id: 'abc' } });
    expect(error).toMatchObject({ status: 402, code: 'SUBSCRIPTION_REQUIRED', message: 'Subscribe', details: { used: 3 }, requestId: 'abc' });
    expect(ApiError.fromResponse(500, null)).toMatchObject({ status: 500, code: null, message: 'Request failed (500)', details: null });
  });
});
