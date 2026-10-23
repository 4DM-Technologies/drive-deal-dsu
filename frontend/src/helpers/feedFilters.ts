import type { BuyerRequest } from '@/types/domain';

/** The "All matched areas" distance: no limit. */
export const ANY_DISTANCE = '250';

export interface FeedFilters {
  search: string;
  /** Ticked choices in each dropdown; an empty list means no filter. Within one dropdown any tick matches. */
  areas: string[];
  brands: string[];
  /** Also show the brands on the dealer's profile. Combines with `brands`: either one lets a request through. */
  myBrands: boolean;
  /** `brand model`, so a model always belongs to one brand. */
  models: string[];
  bodyTypes: string[];
  timelines: string[];
  /** Maximum miles the buyer will travel, or `ANY_DISTANCE`. One choice: a maximum can't usefully be combined. */
  distance: string;
}

export const DEFAULT_FEED_FILTERS: Readonly<FeedFilters> = { search: '', areas: [], brands: [], myBrands: false, models: [], bodyTypes: [], timelines: [], distance: '50' };

export type FeedFacet = 'area' | 'brand' | 'model' | 'bodyType' | 'timeline';

export const TIMELINE_ORDER: readonly BuyerRequest['timeline'][] = ['ASAP', 'Within 1 week', 'Within 2 weeks', 'Just exploring'];
export const FRIENDLY_TIMELINE: Readonly<Record<BuyerRequest['timeline'], string>> = { ASAP: 'Ready to decide', 'Within 1 week': 'Deciding this week', 'Within 2 weeks': 'Deciding in 2–4 weeks', 'Just exploring': 'Researching options' };

const facetValue: Record<FeedFacet, (request: BuyerRequest) => string> = {
  area: (request) => request.area,
  brand: (request) => request.brand,
  model: (request) => `${request.brand} ${request.model}`,
  bodyType: (request) => request.bodyType ?? '',
  timeline: (request) => request.timeline,
};
const FACETS = Object.keys(facetValue) as FeedFacet[];
const FACET_KEY = { area: 'areas', brand: 'brands', model: 'models', bodyType: 'bodyTypes', timeline: 'timelines' } as const satisfies Record<FeedFacet, keyof FeedFilters>;

/** The names of the brands on the dealer's profile, matched ignoring case (catalog brands and ones typed under Other). */
export type MyBrandNames = readonly string[];

const isMine = (brand: string, myBrandNames: MyBrandNames) => myBrandNames.some((name) => name.toLowerCase() === brand.toLowerCase());

/** Whether `request` passes one dropdown's filter. */
function passes(request: BuyerRequest, filters: FeedFilters, facet: FeedFacet, myBrandNames: MyBrandNames): boolean {
  const ticked = filters[FACET_KEY[facet]];
  if (facet === 'brand') {
    if (ticked.length === 0 && !filters.myBrands) return true;
    return ticked.includes(request.brand) || (filters.myBrands && isMine(request.brand, myBrandNames));
  }
  return ticked.length === 0 || ticked.includes(facetValue[facet](request));
}

/** Whether the request passes every active filter; `ignore` leaves one dropdown out, to count what its options would give. */
function matches(request: BuyerRequest, filters: FeedFilters, myBrandNames: MyBrandNames, ignore?: FeedFacet): boolean {
  if (filters.distance !== ANY_DISTANCE && request.radiusMiles > Number(filters.distance)) return false;
  if (FACETS.some((facet) => facet !== ignore && !passes(request, filters, facet, myBrandNames))) return false;
  // Every word typed has to match somewhere, so "audi sedan" narrows to Audi sedans.
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${request.brand} ${request.model} ${request.area} ${request.bodyType ?? ''}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterFeed(requests: readonly BuyerRequest[], filters: FeedFilters, myBrandNames: MyBrandNames = []): BuyerRequest[] {
  return requests.filter((request) => matches(request, filters, myBrandNames));
}

export interface FacetOption { value: string; count: number }

/**
 * The choices for one dropdown, each with how many requests ticking it would add given the other filters. Choices
 * already ticked stay listed even when they would show nothing.
 */
export function facetOptions(requests: readonly BuyerRequest[], filters: FeedFilters, facet: FeedFacet, order?: readonly string[], myBrandNames: MyBrandNames = []): FacetOption[] {
  const counts = new Map<string, number>();
  for (const request of requests) {
    if (!matches(request, filters, myBrandNames, facet)) continue;
    const value = facetValue[facet](request);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const value of filters[FACET_KEY[facet]]) if (!counts.has(value)) counts.set(value, 0);
  const rank = (value: string) => (order ? order.indexOf(value) : 0);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
}

/** How many requests "My brands" would show given the other filters. */
export function myBrandsCount(requests: readonly BuyerRequest[], filters: FeedFilters, myBrandNames: MyBrandNames): number {
  return requests.filter((request) => matches(request, filters, myBrandNames, 'brand') && isMine(request.brand, myBrandNames)).length;
}

/** Applies a change, unticking models whose brand the brand filter no longer lets through. */
export function updateFeedFilters(filters: FeedFilters, patch: Partial<FeedFilters>, myBrandNames: MyBrandNames = []): FeedFilters {
  const next = { ...filters, ...patch };
  if (next.models.length && (next.brands.length > 0 || next.myBrands)) {
    const allowed = (model: string) => next.brands.some((brand) => model.startsWith(`${brand} `))
      || (next.myBrands && myBrandNames.some((name) => model.toLowerCase().startsWith(`${name.toLowerCase()} `)));
    next.models = next.models.filter(allowed);
  }
  return next;
}

/** How many filters differ from the defaults, for the Reset button. Brands and My brands count as one filter. */
export function activeFilterCount(filters: FeedFilters): number {
  return [
    filters.search.trim() !== '',
    filters.areas.length > 0,
    filters.brands.length > 0 || filters.myBrands,
    filters.models.length > 0,
    filters.bodyTypes.length > 0,
    filters.timelines.length > 0,
    filters.distance !== DEFAULT_FEED_FILTERS.distance,
  ].filter(Boolean).length;
}
