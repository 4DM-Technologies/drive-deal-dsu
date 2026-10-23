// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/services/platform/client';
import type { DealerAnalytics } from '@/types/domain';
import { DealerInsights } from './DealerInsights';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const brand = (name: string, count: number, mine = false) => ({ brand: name, count, mine });
const analytics: DealerAnalytics = {
  openRequests: 45,
  newRequests: { last7Days: 1, previous7Days: 5 },
  dailyNewRequests: Array.from({ length: 14 }, (_, index) => ({ date: `2026-10-${String(10 + index).padStart(2, '0')}`, count: index % 3 })),
  byState: [{ state: 'Texas', code: 'TX', count: 33 }, { state: 'New York', code: 'NY', count: 7 }, { state: 'Alabama', code: 'AL', count: 3 }, { state: 'California', code: 'CA', count: 1 }, { state: 'Hawaii', code: 'HI', count: 1 }],
  // Honda is the dealer's but ranks 8th, below the six shown before "Show all".
  byBrand: [brand('Audi', 10), brand('Ford', 5, true), brand('Tesla', 5), brand('BMW', 4, true), brand('Kia', 4), brand('Mercedes-Benz', 4), brand('Toyota', 3), brand('Honda', 2, true), brand('Chevrolet', 2)],
  myBrandsWithoutRequests: ['Rivian'],
  byTimeline: [{ timeline: 'ASAP', count: 20 }, { timeline: 'Within 1 week', count: 10 }, { timeline: 'Within 2 weeks', count: 8 }, { timeline: 'Just exploring', count: 7 }],
  performance: { quotesSent: 40, accepted: 3, declined: 1, winRate: 0.75, buyerViewRate: 0.18, medianResponseHours: 0.02, acceptedValue: '174866.00' },
};

const renderInsights = async () => {
  vi.spyOn(client.dealer, 'analytics').mockResolvedValue(analytics);
  render(<MemoryRouter><DealerInsights /></MemoryRouter>);
  await screen.findByText('Where buyers are, and how you’re doing');
};
const brandCard = () => screen.getByText('What buyers want').closest('article')!;
// The bars on screen; the screen-reader table beside them always lists every row.
const visibleBrands = () => brandCard().querySelector('.insight-bars')!.textContent;

describe('DealerInsights', () => {
  it('says how much new requests went down from last week, and names the weeks on hover', async () => {
    await renderInsights();
    const note = screen.getByText('4 fewer than last week: buyers posted 5 requests last week and 1 this week.');
    expect(note.className).toContain('is-down');
    // The fixture's trend starts Oct 10: last week is Oct 10 – 16, this week Oct 17 – 23.
    expect(note.getAttribute('title')).toBe('Last week: Oct 10 – 16 · This week: Oct 17 – 23');
  });

  it('names every brand, keeps the dealer’s own visible, and shows the rest on request', async () => {
    await renderInsights();
    expect(brandCard().textContent).not.toContain('Other brands');
    // Top six plus Honda (the dealer's, ranked 8th); Toyota and Chevrolet wait behind "Show all".
    expect(visibleBrands()).toContain('Honda');
    expect(visibleBrands()).not.toContain('Toyota');
    fireEvent.click(screen.getByRole('button', { name: /Show all 9 brands/ }));
    expect(visibleBrands()).toContain('Toyota');
    expect(visibleBrands()).toContain('Chevrolet');
    fireEvent.click(screen.getByRole('button', { name: /Show fewer/ }));
    expect(visibleBrands()).not.toContain('Toyota');
  });

  it('names the dealer’s brands that no buyer is asking for', async () => {
    await renderInsights();
    expect(brandCard().textContent).toContain('No open requests right now for your brand: Rivian.');
  });

  it('lists every state by name, without a "Show all" when there are only a few', async () => {
    await renderInsights();
    const states = screen.getByText('Where buyers are').closest('article')!;
    expect(states.querySelector('.insight-bars')!.textContent).toContain('Hawaii');
    expect(states.textContent).not.toContain('Other states');
    expect(states.querySelector('.insight-more')).toBeNull();
  });
});
