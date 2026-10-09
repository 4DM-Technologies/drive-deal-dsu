import { describe, expect, it } from 'vitest';

import { hasGuidedHistoryOptions, normalizeRequestDraft } from './AdvisorScreen';

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
