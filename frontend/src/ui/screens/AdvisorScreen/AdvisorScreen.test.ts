import { describe, expect, it } from 'vitest';

import { advisorResponseActions, chosenGuidedOption, hasGuidedHistoryOptions, mergeLocalGreeting, normalizeRequestDraft, shouldShowAdvisorComposer } from './AdvisorScreen';

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

  it('hides the composer while a saved-preferences choice is waiting for an answer', () => {
    expect(shouldShowAdvisorComposer(null, true)).toBe(false);
    expect(shouldShowAdvisorComposer('complete', true)).toBe(false);
    expect(shouldShowAdvisorComposer(null, false)).toBe(true);
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

describe('chosenGuidedOption', () => {
  const options = ['I know the car I want', 'Help me choose', 'Ask Sera a question'];

  it('reads the choice from the message the buyer sent next', () => {
    expect(chosenGuidedOption(options, 'I know the car I want')).toBe('I know the car I want');
    expect(chosenGuidedOption(options, 'Help me choose a car')).toBe('Help me choose');
  });

  it('falls back to the remembered click when the reply does not name an option', () => {
    expect(chosenGuidedOption(options, 'what is the safest SUV?', 'Ask Sera a question')).toBe('Ask Sera a question');
    expect(chosenGuidedOption(options, undefined, 'Ask Sera a question')).toBe('Ask Sera a question');
  });

  it('highlights nothing when there is no choice to show', () => {
    expect(chosenGuidedOption(options, 'what is the safest SUV?')).toBeNull();
    expect(chosenGuidedOption(options, undefined, 'Something else')).toBeNull();
    expect(chosenGuidedOption(undefined, 'Help me choose a car')).toBeNull();
  });
});

describe('mergeLocalGreeting', () => {
  const greeting = { id: 'g', role: 'assistant' as const, body: 'Hi, I’m Sera', guidedStep: 'start' as const, options: ['Ask Sera a question'] };
  const hey = { id: 's-0-user', role: 'user' as const, body: 'hey' };
  const reply = { id: 's-0-assistant', role: 'assistant' as const, body: 'Hi! What can I help with?' };

  it('keeps the server conversation when the local copy is stale (saved before the buyer typed)', () => {
    expect(mergeLocalGreeting([greeting], [hey, reply])).toEqual([greeting, hey, reply]);
  });

  it('keeps only the local greeting, never stale local messages after it', () => {
    const staleLocal = [greeting, { id: 'u', role: 'user' as const, body: 'hey' }, { id: 'a', role: 'assistant' as const, body: '' }];
    expect(mergeLocalGreeting(staleLocal, [hey, reply])).toEqual([greeting, hey, reply]);
  });

  it('falls back to the local copy only when the server has nothing', () => {
    expect(mergeLocalGreeting([greeting], [])).toEqual([greeting]);
    expect(mergeLocalGreeting(undefined, [hey])).toEqual([hey]);
  });
});
