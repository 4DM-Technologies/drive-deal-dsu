import { describe, expect, it } from 'vitest';
import { ANY_DISTANCE, DEFAULT_FEED_FILTERS, TIMELINE_ORDER, activeFilterCount, facetOptions, filterFeed, myBrandsCount, updateFeedFilters, type FeedFilters } from '@/helpers/feedFilters';
import type { BuyerRequest } from '@/types/domain';

let nextId = 0;
const request = (over: Partial<BuyerRequest>): BuyerRequest => ({
  id: `r${++nextId}`, buyerId: 'b', brand: 'Audi', model: 'A4', bodyType: 'Sedan', yearMin: null, yearMax: null, budgetMin: null, budgetMax: null, targetOtdPrice: null,
  area: 'Frisco, Texas', radiusMiles: 25, timeline: 'ASAP', status: 'open', quoteCount: 0, viewCount: 0, createdAt: '2026-10-01', expiresAt: '2026-11-01', image: '', mustHaves: [], alreadyQuoted: false, dealersNotifiedAt: null, repushedAt: null, canNotifyDealers: false, canRepush: false, ...over,
});

const feed = [
  request({ brand: 'Audi', model: 'A4', bodyType: 'Sedan', area: 'Frisco, Texas', radiusMiles: 25, timeline: 'ASAP' }),
  request({ brand: 'Audi', model: 'Q5', bodyType: 'SUV', area: 'Plano, Texas', radiusMiles: 50, timeline: 'Within 2 weeks' }),
  request({ brand: 'Tesla', model: 'Model Y', bodyType: 'SUV', area: 'Frisco, Texas', radiusMiles: 100, timeline: 'Within 1 week' }),
  request({ brand: 'Tesla', model: 'Model 3', bodyType: 'Sedan', area: 'Austin, Texas', radiusMiles: 250, timeline: 'Just exploring' }),
  request({ brand: 'Kia', model: 'EV9', bodyType: 'SUV', area: 'Austin, Texas', radiusMiles: 25, timeline: 'ASAP' }),
];
const all = (over: Partial<FeedFilters> = {}): FeedFilters => ({ ...DEFAULT_FEED_FILTERS, distance: ANY_DISTANCE, ...over });
const models = (filters: FeedFilters, mine: string[] = []) => filterFeed(feed, filters, mine).map((item) => `${item.brand} ${item.model}`);

describe('filterFeed', () => {
  it('shows everything when nothing is filtered and distance is unlimited', () => {
    expect(filterFeed(feed, all())).toHaveLength(5);
  });

  it('limits by how far the buyer will travel, except on "Any distance"', () => {
    expect(models({ ...DEFAULT_FEED_FILTERS, distance: '50' })).toEqual(['Audi A4', 'Audi Q5', 'Kia EV9']);
    expect(models(all({ distance: '100' }))).toEqual(['Audi A4', 'Audi Q5', 'Tesla Model Y', 'Kia EV9']);
  });

  it('shows requests in any of the ticked areas, and for any of the ticked brands', () => {
    expect(models(all({ areas: ['Frisco, Texas'] }))).toEqual(['Audi A4', 'Tesla Model Y']);
    expect(models(all({ areas: ['Frisco, Texas', 'Plano, Texas'] }))).toEqual(['Audi A4', 'Audi Q5', 'Tesla Model Y']);
    expect(models(all({ brands: ['Tesla', 'Kia'] }))).toEqual(['Tesla Model Y', 'Tesla Model 3', 'Kia EV9']);
  });

  it('shows requests for any of the ticked models, body types and timings', () => {
    expect(models(all({ models: ['Audi Q5'] }))).toEqual(['Audi Q5']);
    expect(models(all({ models: ['Audi Q5', 'Kia EV9'] }))).toEqual(['Audi Q5', 'Kia EV9']);
    expect(models(all({ bodyTypes: ['Sedan'] }))).toEqual(['Audi A4', 'Tesla Model 3']);
    expect(models(all({ bodyTypes: ['Sedan', 'SUV'] }))).toHaveLength(5);
    expect(models(all({ timelines: ['ASAP'] }))).toEqual(['Audi A4', 'Kia EV9']);
    expect(models(all({ timelines: ['ASAP', 'Just exploring'] }))).toEqual(['Audi A4', 'Tesla Model 3', 'Kia EV9']);
  });

  it('needs every dropdown to match: (any ticked area) and (any ticked brand)', () => {
    expect(models(all({ areas: ['Frisco, Texas', 'Austin, Texas'], brands: ['Tesla'] }))).toEqual(['Tesla Model Y', 'Tesla Model 3']);
    expect(models(all({ areas: ['Plano, Texas'], brands: ['Tesla', 'Kia'] }))).toEqual([]);
  });

  it('matches every typed word against brand, model, area and body type', () => {
    expect(models(all({ search: 'tesla suv' }))).toEqual(['Tesla Model Y']);
    expect(models(all({ search: '  PLANO ' }))).toEqual(['Audi Q5']);
  });
});

describe('My brands', () => {
  it('shows the brands on the dealer profile, ignoring case', () => {
    expect(models(all({ myBrands: true }), ['tesla', 'Ford'])).toEqual(['Tesla Model Y', 'Tesla Model 3']);
  });

  it('adds to the ticked brands rather than replacing them', () => {
    expect(models(all({ myBrands: true, brands: ['Kia'] }), ['Tesla'])).toEqual(['Tesla Model Y', 'Tesla Model 3', 'Kia EV9']);
  });

  it('shows nothing when no request is for the dealer’s brands', () => {
    expect(models(all({ myBrands: true }), ['Ford'])).toEqual([]);
    expect(models(all({ myBrands: true }), [])).toEqual([]);
  });

  it('counts what it would show with the other filters', () => {
    expect(myBrandsCount(feed, all(), ['Tesla', 'Audi'])).toBe(4);
    expect(myBrandsCount(feed, all({ areas: ['Frisco, Texas'] }), ['Tesla', 'Audi'])).toBe(2);
  });
});

describe('facetOptions', () => {
  it('lists each choice once with how many requests it would show', () => {
    expect(facetOptions(feed, all(), 'brand')).toEqual([{ value: 'Audi', count: 2 }, { value: 'Kia', count: 1 }, { value: 'Tesla', count: 2 }]);
  });

  it('counts against the other filters but not its own, so more choices can be ticked', () => {
    const filters = all({ brands: ['Tesla'], bodyTypes: ['SUV'] });
    expect(facetOptions(feed, filters, 'brand')).toEqual([{ value: 'Audi', count: 1 }, { value: 'Kia', count: 1 }, { value: 'Tesla', count: 1 }]);
    expect(facetOptions(feed, filters, 'model')).toEqual([{ value: 'Tesla Model Y', count: 1 }]);
  });

  it('keeps ticked choices listed even when they would show nothing', () => {
    expect(facetOptions(feed, all({ areas: ['Plano, Texas'], brands: ['Kia'] }), 'brand')).toEqual([{ value: 'Audi', count: 1 }, { value: 'Kia', count: 0 }]);
  });

  it('ignores requests with no body type and follows a given order', () => {
    const withGap = [...feed, request({ bodyType: null })];
    expect(facetOptions(withGap, all(), 'bodyType').map((option) => option.value)).toEqual(['Sedan', 'SUV']);
    expect(facetOptions(feed, all(), 'timeline', TIMELINE_ORDER).map((option) => option.value)).toEqual(['ASAP', 'Within 1 week', 'Within 2 weeks', 'Just exploring']);
  });
});

describe('updateFeedFilters', () => {
  it('unticks only the models whose brand is no longer let through', () => {
    const next = updateFeedFilters(all({ brands: ['Audi', 'Tesla'], models: ['Audi A4', 'Tesla Model Y'] }), { brands: ['Tesla'] });
    expect(next.models).toEqual(['Tesla Model Y']);
  });

  it('keeps models whose brand is let through by a tick or by My brands', () => {
    expect(updateFeedFilters(all({ models: ['Tesla Model Y'] }), { brands: ['Audi', 'Tesla'] }).models).toEqual(['Tesla Model Y']);
    expect(updateFeedFilters(all({ models: ['Tesla Model Y'] }), { myBrands: true }, ['tesla']).models).toEqual(['Tesla Model Y']);
  });
});

describe('activeFilterCount', () => {
  it('counts filters that differ from the defaults, with brands and My brands as one', () => {
    expect(activeFilterCount(DEFAULT_FEED_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, search: '   ' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, search: 'audi', areas: ['Plano, Texas', 'Frisco, Texas'], brands: ['Audi'], myBrands: true, distance: ANY_DISTANCE })).toBe(4);
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, models: ['Audi A4'], bodyTypes: ['SUV', 'Sedan'], timelines: ['ASAP'] })).toBe(3);
  });
});
