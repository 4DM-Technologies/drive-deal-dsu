import { describe, expect, it } from 'vitest';

import { daysLeft, planBlurb, planCatalog, planDetailLine, premiumName, starterState, upgradeHint } from '@/helpers/plans';
import { parseSubscription } from '@/helpers/subscription';

const dealerTrial = {
  role: 'dealer', plan: 'trial', is_premium: false, premium_expires_at: null,
  trial_started_at: '2026-10-06T13:02:42+00:00', trial_expires_at: '2026-12-05T13:02:42+00:00',
  premium_price: '500.00', currency: 'USD', quote_limit: 3, quotes_used: 1, quotes_remaining: 2, can_quote: true,
};
const buyerFree = {
  role: 'buyer', plan: 'free', is_premium: false, premium_expires_at: null, trial_started_at: null, trial_expires_at: null,
  premium_price: '100.00', currency: 'USD', request_limit: 3, requests_used: 1, requests_remaining: 2, can_create_request: true, ai_posting_allowed: true,
};
const sub = (row: object) => parseSubscription(row)!;

describe('planCatalog', () => {
  it('describes the dealer trial and Premium dealer', () => {
    const { starter, premium } = planCatalog('dealer', '500.00');
    expect(starter).toMatchObject({ name: 'Free trial', price: '$0', period: 'for 2 months' });
    expect(starter.features).toContain('Up to 3 quotes in total');
    expect(premium).toMatchObject({ name: 'Premium dealer', price: '$500', period: 'per year' });
    expect(premium.features).toContain('Unlimited quotes');
    expect(premium.features).toContain('Valid for one full year');
  });

  it('describes the buyer free plan and Premium', () => {
    const { starter, premium } = planCatalog('buyer', '100.00');
    expect(starter.features).toContain('Up to 3 car-buy requests in total');
    expect(starter.features).toContain('Limited Sera AI features');
    expect(premium).toMatchObject({ name: 'Premium', price: '$100' });
    expect(premium.features).toContain('Unlimited car-buy requests');
    expect(premium.features).toContain('Unlimited access to Sera, your AI advisor');
  });

  it('keeps every visible string free of em dashes', () => {
    for (const role of ['dealer', 'buyer'] as const) {
      const { starter, premium } = planCatalog(role, '100.00');
      for (const text of [starter.tagline, premium.tagline, starter.lead, premium.lead, ...starter.features, ...premium.features]) expect(text).not.toMatch(/[—–]/);
    }
  });
});

describe('starterState', () => {
  it('is current while the plan can still create', () => {
    expect(starterState(sub(dealerTrial))).toBe('current');
    expect(starterState(sub(buyerFree))).toBe('current');
  });

  it('is ended once the quota or trial is used up', () => {
    expect(starterState(sub({ ...dealerTrial, quotes_used: 3, quotes_remaining: 0, can_quote: false }))).toBe('ended');
    expect(starterState(sub({ ...dealerTrial, plan: 'free', can_quote: false }))).toBe('ended');
    expect(starterState(sub({ ...buyerFree, requests_used: 3, requests_remaining: 0, can_create_request: false }))).toBe('ended');
  });

  it('is inactive while Premium is running', () => {
    expect(starterState(sub({ ...buyerFree, plan: 'premium', is_premium: true }))).toBe('inactive');
  });
});

describe('planDetailLine', () => {
  it('reads out what is left', () => {
    expect(planDetailLine(sub(dealerTrial))).toBe('2 of 3 quotes left');
    expect(planDetailLine(sub(buyerFree))).toBe('2 of 3 requests left');
  });

  it('says so when the quota or trial is used up', () => {
    expect(planDetailLine(sub({ ...dealerTrial, quotes_used: 3, quotes_remaining: 0, can_quote: false }))).toBe('All 3 quotes used');
    expect(planDetailLine(sub({ ...dealerTrial, plan: 'free', can_quote: false, quote_limit: 0, quotes_remaining: 0 }))).toBe('Trial period is over');
    expect(planDetailLine(sub({ ...buyerFree, requests_used: 3, requests_remaining: 0, can_create_request: false }))).toBe('All 3 requests used');
  });

  it('gives the end date while Premium is running', () => {
    expect(planDetailLine(sub({ ...dealerTrial, plan: 'premium', is_premium: true, premium_expires_at: '2027-10-06T12:00:00+00:00' }))).toMatch(/^Valid until October (5|6|7), 2027$/);
    expect(planDetailLine(sub({ ...buyerFree, plan: 'premium', is_premium: true }))).toBe('Active');
  });

  it('names the paid tier by role', () => {
    expect(premiumName('dealer')).toBe('Premium dealer');
    expect(premiumName('buyer')).toBe('Premium');
  });
});

describe('daysLeft', () => {
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  it('counts down a running trial or Premium year', () => {
    expect(daysLeft(sub({ ...dealerTrial, trial_expires_at: inDays(10) }))).toBe(10);
    expect(daysLeft(sub({ ...dealerTrial, plan: 'premium', is_premium: true, premium_expires_at: inDays(300) }))).toBe(300);
  });

  it('is null with no end date and never goes below zero', () => {
    expect(daysLeft(sub(buyerFree))).toBeNull();
    expect(daysLeft(sub({ ...dealerTrial, trial_expires_at: inDays(-3) }))).toBe(0);
  });
});

describe('planBlurb', () => {
  it('describes a live trial and a live free plan', () => {
    expect(planBlurb(sub(dealerTrial))).toMatch(/^Your trial runs until December [45], 2026\. It includes up to 3 quotes in total\.$/);
    expect(planBlurb(sub(buyerFree))).toBe('Your free plan includes 3 car-buy requests in total.');
  });

  it('explains what happens once the plan is used up', () => {
    expect(planBlurb(sub({ ...buyerFree, requests_used: 3, can_create_request: false }))).toContain('Upgrade to Premium');
  });

  it('describes a running Premium plan', () => {
    expect(planBlurb(sub({ ...buyerFree, plan: 'premium', is_premium: true, premium_expires_at: '2027-10-06T12:00:00+00:00' }))).toMatch(/^Premium runs until October (5|6|7), 2027\. You have unlimited requests until then\. Renewing adds a full year on top\.$/);
  });
});

describe('upgradeHint', () => {
  it('pitches the upgrade while live and explains it once blocked', () => {
    expect(upgradeHint(sub(dealerTrial))).toBe('Unlimited quotes for $500 a year');
    expect(upgradeHint(sub(buyerFree))).toBe('Unlimited requests for $100 a year');
    expect(upgradeHint(sub({ ...dealerTrial, plan: 'free', can_quote: false }))).toBe('Your trial is over. Upgrade to keep quoting.');
    expect(upgradeHint(sub({ ...buyerFree, requests_used: 3, can_create_request: false }))).toBe('Free requests used. Upgrade to post more.');
  });
});
