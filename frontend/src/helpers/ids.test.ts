import { afterEach, describe, expect, it } from 'vitest';

import { createId, isUuidV4 } from '@/helpers/ids';

const originalCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true, writable: true });
});

describe('createId', () => {
  it('uses the platform UUID generator when it is available', () => {
    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('still returns a v4 UUID when randomUUID is missing on a plain-HTTP origin', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) },
      configurable: true,
      writable: true,
    });

    const id = createId();

    expect(isUuidV4(id)).toBe(true);
  });

  it('falls back to Math.random when no Web Crypto source exists', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });

    expect(isUuidV4(createId())).toBe(true);
  });

  it('never repeats across rapid calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId()));

    expect(ids.size).toBe(500);
  });
});

describe('isUuidV4', () => {
  it('rejects values that are not v4 UUIDs', () => {
    expect(isUuidV4('not-an-id')).toBe(false);
    expect(isUuidV4('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});