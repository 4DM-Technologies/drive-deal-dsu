import { describe, expect, it } from 'vitest';
import { MAX_OTHER_BRANDS, addOtherBrand, sameBrands } from '@/helpers/dealerBrands';
import type { BrandRef } from '@/types/domain';

const catalog = [{ id: 'ford', name: 'Ford' }, { id: 'bmw', name: 'BMW' }] as BrandRef[];

describe('addOtherBrand', () => {
  it('adds a new brand with tidy spacing', () => {
    expect(addOtherBrand('  Lucid   Motors ', catalog, [])).toEqual({ kind: 'other', name: 'Lucid Motors' });
  });

  it('selects the catalog brand when the typed name is already listed', () => {
    expect(addOtherBrand('bmw', catalog, [])).toEqual({ kind: 'catalog', brandId: 'bmw' });
  });

  it('refuses names that are too short, repeated, or over the limit', () => {
    expect(addOtherBrand('x', catalog, []).kind).toBe('error');
    expect(addOtherBrand('rivian', catalog, ['Rivian'])).toEqual({ kind: 'error', message: 'rivian is already added.' });
    const full = Array.from({ length: MAX_OTHER_BRANDS }, (_, index) => `Brand ${index}`);
    expect(addOtherBrand('Polestar', catalog, full).kind).toBe('error');
  });
});

it('compares selections without caring about order', () => {
  expect(sameBrands(['a', 'b'], ['b', 'a'])).toBe(true);
  expect(sameBrands(['a'], ['a', 'b'])).toBe(false);
});
