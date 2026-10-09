import type { BuyerRequest } from '@/types/domain';

/** The "no filter" value every dropdown starts on. */
export const ALL = 'all';
/** The "All matched areas" distance: no limit. */
export const ANY_DISTANCE = '250';

export interface FeedFilters {
  search: string;
  area: string;
  brand: string;
  /** `brand model`, so a model always belongs to one brand. */
  model: string;
  bodyType: string;
  timeline: string;
  /** Maximum miles the buyer will travel, or `ANY_DISTANCE`. */
  distance: string;
}

export const DEFAULT_FEED_FILTERS: Readonly<FeedFilters> = { search: '', area: ALL, brand: ALL, model: ALL, bodyType: ALL, timeline: ALL, distance: '50' };

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

/** Whether the request passes every active filter; `ignore` leaves one dropdown out, to count what its options would give. */
function matches(request: BuyerRequest, filters: FeedFilters, ignore?: FeedFacet): boolean {
  if (filters.distance !== ANY_DISTANCE && request.radiusMiles > Number(filters.distance)) return false;
  if (FACETS.some((facet) => facet !== ignore && filters[facet] !== ALL && facetValue[facet](request) !== filters[facet])) return false;
  // Every word typed has to match somewhere, so "audi sedan" narrows to Audi sedans.
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${request.brand} ${request.model} ${request.area} ${request.bodyType ?? ''}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterFeed(requests: readonly BuyerRequest[], filters: FeedFilters): BuyerRequest[] {
  return requests.filter((request) => matches(request, filters));
}

export interface FacetOption { value: string; count: number }

/**
 * The choices for one dropdown, each with how many requests picking it would show given the other filters, so no
 * choice ever leads to an empty feed. The current choice stays listed even when it would show nothing.
 */
export function facetOptions(requests: readonly BuyerRequest[], filters: FeedFilters, facet: FeedFacet, order?: readonly string[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const request of requests) {
    if (!matches(request, filters, facet)) continue;
    const value = facetValue[facet](request);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (filters[facet] !== ALL && !counts.has(filters[facet])) counts.set(filters[facet], 0);
  const rank = (value: string) => (order ? order.indexOf(value) : 0);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
}

/** Applies a change, dropping a model that no longer belongs to the chosen brand. */
export function updateFeedFilters(filters: FeedFilters, patch: Partial<FeedFilters>): FeedFilters {
  const next = { ...filters, ...patch };
  if (next.brand !== ALL && next.model !== ALL && !next.model.startsWith(`${next.brand} `)) next.model = ALL;
  return next;
}

/** How many filters differ from the defaults, for the Reset button. */
export function activeFilterCount(filters: FeedFilters): number {
  return (Object.keys(DEFAULT_FEED_FILTERS) as (keyof FeedFilters)[]).filter((key) => (key === 'search' ? filters.search.trim() !== '' : filters[key] !== DEFAULT_FEED_FILTERS[key])).length;
}
