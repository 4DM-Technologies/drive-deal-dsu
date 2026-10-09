import { describe, expect, it } from 'vitest';
import { violatesChatGuidelines } from './communityGuidelines';

describe('chat community guidelines', () => {
  it('flags profanity in ordinary and obfuscated forms', () => {
    expect(violatesChatGuidelines('fuckman')).toBe(true);
    expect(violatesChatGuidelines('f.u.c.k')).toBe(true);
    expect(violatesChatGuidelines('sh1t')).toBe(true);
  });

  it('allows respectful car-buying messages', () => {
    expect(violatesChatGuidelines('Can you confirm the delivery date?')).toBe(false);
    expect(violatesChatGuidelines('The car is ready for a test drive.')).toBe(false);
  });
});
