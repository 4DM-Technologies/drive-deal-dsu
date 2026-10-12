import { describe, expect, it } from 'vitest';

import { advisorResponseActions, hasGuidedHistoryOptions, normalizeRequestDraft, shouldShowAdvisorComposer } from './AdvisorScreen';

describe('shouldShowAdvisorComposer', () => {
  it('keeps the standard composer out of the guided HITL and review steps', () => {
    expect(shouldShowAdvisorComposer('start')).toBe(false);
    expect(shouldShowAdvisorComposer('card')).toBe(false);
    expect(shouldShowAdvisorComposer('review')).toBe(false);
  });

  it('shows the composer for open chat and after the request is posted', () => {
    expect(shouldShowAdvisorComposer(null)).toBe(true);
    expect(shouldShowAdvisorComposer('complete')).toBe(true);
  });
});

describe('advisorResponseActions', () => {
  it('offers relevant next steps after a car shortlist', () => {
    const actions = advisorResponseActions([
      'Five sports cars worth a look:',
      '1. **Chevrolet Corvette Stingray** — Fast and practical.',
      '2. **Porsche 718 Cayman** — Balanced handling.',
      '3. **Mazda MX-5 Miata** — Lightweight and affordable.',
    ].join('\n'));
    expect(actions.map((action) => action.label)).toEqual(['Show photos', 'Compare the shortlist', 'Find the best value']);
  });

  it('offers a retry when some requested photos are still missing', () => {
    const actions = advisorResponseActions('I found a matching photo for **Nissan Z**. I’m still missing photos for Chevrolet Corvette.');
    expect(actions.map((action) => action.label)).toEqual(['Try the missing photos again', 'Compare these cars']);
    expect(actions.at(0)?.prompt).toContain('remaining cars');
  });

  it('does not add unrelated suggestions to a simple answer', () => {
    expect(advisorResponseActions('The Miata is a lightweight roadster.')).toEqual([]);
  });
});

describe('hasGuidedHistoryOptions', () => {
  it('does not render a zero for an empty options list', () => {
    expect(hasGuidedHistoryOptions([])).toBe(false);
    expect(hasGuidedHistoryOptions(undefined)).toBe(false);
  });

  it('renders saved options when Sera offered some', () => {
    expect(hasGuidedHistoryOptions(['2026', '2027'])).toBe(true);
  });
});

describe('normalizeRequestDraft', () => {
  it('does not expose structured clarification questions to React as text fields', () => {
    expect(normalizeRequestDraft({
      questions: [{ field: 'budget', question: 'What is your budget?', options: ['$30k', '$40k'], multiple: false }],
    })).toBeNull();
  });

  it('keeps only render-safe buying request values', () => {
    expect(normalizeRequestDraft({
      brand: 'BMW',
      model_name: 'X3',
      must_haves: ['AWD', 'heated seats'],
      internal: { unsafe: true },
    })).toEqual({
      brand: 'BMW',
      model: 'X3',
      mustHaves: 'AWD, heated seats',
    });
  });
});
