import { describe, expect, it } from 'vitest';
import { guidedStepToDomain } from './httpClient';

describe('guidedStepToDomain', () => {
  it('maps the planner question and keeps the answers untouched for the next call', () => {
    const answers = { entry: 'model', make_slug: 'bmw', model_slug: 'm3', answered: [] };
    const step = guidedStepToDomain({
      answers,
      question: {
        id: 'variant', title: 'Which M3?', index: 1, total: 5, allow_other: true, other_placeholder: 'Something else…',
        multi_select: false, skippable: true, options: [{ value: 'v1', label: 'M3 Sedan', description: 'Manual' }],
      },
      draft: null, message: null, unresolved: false,
    });
    expect(step.answers).toBe(answers);
    expect(step.question).toMatchObject({ id: 'variant', allowOther: true, multiSelect: false, skippable: true, index: 1, total: 5 });
    expect(step.question?.options[0]).toEqual({ value: 'v1', label: 'M3 Sedan', description: 'Manual' });
  });

  it('returns the finished draft when there is no next question', () => {
    const step = guidedStepToDomain({ answers: {}, question: null, draft: { brand: 'BMW', model: 'M3' }, message: 'Switched to the BMW M3.', unresolved: false });
    expect(step.question).toBeNull();
    expect(step.draft).toEqual({ brand: 'BMW', model: 'M3' });
    expect(step.message).toBe('Switched to the BMW M3.');
  });
});
