import type { BrandRef } from '@/types/domain';

// Mirrors the API's rules for brands typed under "Other" (backend models/auth.py), so problems show before saving.
export const MAX_OTHER_BRANDS = 10;
export const OTHER_BRAND_MIN = 2;
export const OTHER_BRAND_MAX = 60;

export type AddOtherResult =
  | { kind: 'catalog'; brandId: string }
  | { kind: 'other'; name: string }
  | { kind: 'error'; message: string };

/**
 * What adding a typed brand name should do: select the catalog brand it names, add it as an "other" brand, or explain
 * why it can't be added.
 */
export function addOtherBrand(typed: string, catalog: BrandRef[], others: string[]): AddOtherResult {
  const name = typed.split(/\s+/).filter(Boolean).join(' ');
  if (name.length < OTHER_BRAND_MIN || name.length > OTHER_BRAND_MAX) return { kind: 'error', message: `Brand names are ${OTHER_BRAND_MIN} to ${OTHER_BRAND_MAX} characters.` };
  const match = catalog.find((brand) => brand.name.toLowerCase() === name.toLowerCase());
  if (match) return { kind: 'catalog', brandId: match.id };
  if (others.some((other) => other.toLowerCase() === name.toLowerCase())) return { kind: 'error', message: `${name} is already added.` };
  if (others.length >= MAX_OTHER_BRANDS) return { kind: 'error', message: `Add up to ${MAX_OTHER_BRANDS} other brands.` };
  return { kind: 'other', name };
}

/** Whether two brand selections are the same, ignoring order. */
export function sameBrands(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}
