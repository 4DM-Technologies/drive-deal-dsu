import { describe, expect, it } from 'vitest';
import { ALL, ANY_DISTANCE, DEFAULT_FEED_FILTERS, TIMELINE_ORDER, activeFilterCount, facetOptions, filterFeed, updateFeedFilters, type FeedFilters } from '@/helpers/feedFilters';
import type { BuyerRequest } from '@/types/domain';

let nextId = 0;
const request = (over: Partial<BuyerRequest>): BuyerRequest => ({
  id: `r${++nextId}`, buyerId: 'b', brand: 'Audi', model: 'A4', bodyType: 'Sedan', yearMin: null, yearMax: null, budgetMin: null, budgetMax: null, targetOtdPrice: null,
  area: 'Frisco, Texas', radiusMiles: 25, timeline: 'ASAP', status: 'open', quoteCount: 0, viewCount: 0, createdAt: '2026-10-01', expiresAt: '2026-11-01', image: '', mustHaves: [], alreadyQuoted: false, ...over,
});

const feed = [
  request({ brand: 'Audi', model: 'A4', bodyType: 'Sedan', area: 'Frisco, Texas', radiusMiles: 25, timeline: 'ASAP' }),
  request({ brand: 'Audi', model: 'Q5', bodyType: 'SUV', area: 'Plano, Texas', radiusMiles: 50, timeline: 'Within 2 weeks' }),
  request({ brand: 'Tesla', model: 'Model Y', bodyType: 'SUV', area: 'Frisco, Texas', radiusMiles: 100, timeline: 'Within 1 week' }),
  request({ brand: 'Tesla', model: 'Model 3', bodyType: 'Sedan', area: 'Austin, Texas', radiusMiles: 250, timeline: 'Just exploring' }),
];
const all = (over: Partial<FeedFilters> = {}): FeedFilters => ({ ...DEFAULT_FEED_FILTERS, distance: ANY_DISTANCE, ...over });
const models = (filters: FeedFilters) => filterFeed(feed, filters).map((item) => `${item.brand} ${item.model}`);

describe('filterFeed', () => {
  it('shows everything when nothing is filtered and distance is unlimited', () => {
    expect(filterFeed(feed, all())).toHaveLength(4);
  });

  it('limits by how far the buyer will travel, except on "All matched areas"', () => {
    expect(models({ ...DEFAULT_FEED_FILTERS, distance: '50' })).toEqual(['Audi A4', 'Audi Q5']);
    expect(models(all({ distance: '100' }))).toEqual(['Audi A4', 'Audi Q5', 'Tesla Model Y']);
    expect(models(all({ distance: ANY_DISTANCE }))).toHaveLength(4);
  });

  it('filters by area, brand, model, body type and timeline', () => {
    expect(models(all({ area: 'Frisco, Texas' }))).toEqual(['Audi A4', 'Tesla Model Y']);
    expect(models(all({ brand: 'Tesla' }))).toEqual(['Tesla Model Y', 'Tesla Model 3']);
    expect(models(all({ model: 'Audi Q5' }))).toEqual(['Audi Q5']);
    expect(models(all({ bodyType: 'SUV' }))).toEqual(['Audi Q5', 'Tesla Model Y']);
    expect(models(all({ timeline: 'ASAP' }))).toEqual(['Audi A4']);
  });

  it('combines filters', () => {
    expect(models(all({ brand: 'Tesla', bodyType: 'SUV', area: 'Frisco, Texas' }))).toEqual(['Tesla Model Y']);
    expect(models(all({ brand: 'Audi', area: 'Austin, Texas' }))).toEqual([]);
  });

  it('matches every typed word against brand, model, area and body type', () => {
    expect(models(all({ search: 'tesla suv' }))).toEqual(['Tesla Model Y']);
    expect(models(all({ search: '  PLANO ' }))).toEqual(['Audi Q5']);
    expect(models(all({ search: 'audi austin' }))).toEqual([]);
  });
});

describe('facetOptions', () => {
  it('lists each choice once with how many requests it would show', () => {
    expect(facetOptions(feed, all(), 'brand')).toEqual([{ value: 'Audi', count: 2 }, { value: 'Tesla', count: 2 }]);
    expect(facetOptions(feed, all(), 'area')).toEqual([{ value: 'Austin, Texas', count: 1 }, { value: 'Frisco, Texas', count: 2 }, { value: 'Plano, Texas', count: 1 }]);
  });

  it('counts against the other filters but not its own, so the choice can be switched', () => {
    const filters = all({ brand: 'Tesla', bodyType: 'SUV' });
    expect(facetOptions(feed, filters, 'brand')).toEqual([{ value: 'Audi', count: 1 }, { value: 'Tesla', count: 1 }]);
    expect(facetOptions(feed, filters, 'model')).toEqual([{ value: 'Tesla Model Y', count: 1 }]);
  });

  it('leaves out choices that would show nothing, but keeps the current one', () => {
    expect(facetOptions(feed, all({ area: 'Austin, Texas' }), 'brand')).toEqual([{ value: 'Tesla', count: 1 }]);
    expect(facetOptions(feed, all({ area: 'Austin, Texas', brand: 'Audi' }), 'brand')).toEqual([{ value: 'Audi', count: 0 }, { value: 'Tesla', count: 1 }]);
  });

  it('ignores requests with no body type and follows a given order', () => {
    const withGap = [...feed, request({ bodyType: null })];
    expect(facetOptions(withGap, all(), 'bodyType').map((option) => option.value)).toEqual(['Sedan', 'SUV']);
    expect(facetOptions(feed, all(), 'timeline', TIMELINE_ORDER).map((option) => option.value)).toEqual(['ASAP', 'Within 1 week', 'Within 2 weeks', 'Just exploring']);
  });
});

describe('updateFeedFilters', () => {
  it('drops a model that does not belong to the newly chosen brand', () => {
    const next = updateFeedFilters(all({ brand: 'Audi', model: 'Audi A4' }), { brand: 'Tesla' });
    expect(next.brand).toBe('Tesla');
    expect(next.model).toBe(ALL);
  });

  it('keeps a model that matches the brand', () => {
    expect(updateFeedFilters(all({ model: 'Tesla Model Y' }), { brand: 'Tesla' }).model).toBe('Tesla Model Y');
  });
});

describe('activeFilterCount', () => {
  it('counts filters that differ from the defaults', () => {
    expect(activeFilterCount(DEFAULT_FEED_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, search: '   ' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, search: 'audi', brand: 'Audi', distance: ANY_DISTANCE })).toBe(3);
  });
});
