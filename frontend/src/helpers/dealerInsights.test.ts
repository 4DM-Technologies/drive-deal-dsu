import { describe, expect, it } from 'vitest';
import { dayRange, percent, rate, responseTime, shortDay, visibleRows, weekChange } from '@/helpers/dealerInsights';

describe('visibleRows', () => {
  const rows = [{ brand: 'Audi', mine: false }, { brand: 'Ford', mine: true }, { brand: 'Kia', mine: false }, { brand: 'Honda', mine: true }, { brand: 'Fiat', mine: false }];

  it('shows the top rows', () => {
    expect(visibleRows(rows, 2).map((row) => row.brand)).toEqual(['Audi', 'Ford']);
  });

  it('also keeps pinned rows that rank lower, in their place', () => {
    expect(visibleRows(rows, 2, (row) => row.mine).map((row) => row.brand)).toEqual(['Audi', 'Ford', 'Honda']);
  });

  it('shows everything when the list is short', () => {
    expect(visibleRows(rows, 10)).toHaveLength(5);
  });
});

describe('number wording', () => {
  it('formats shares and rates, with a dash when unknown', () => {
    expect(percent(4, 10)).toBe('40%');
    expect(percent(1, 0)).toBe('—');
    expect(rate(0.666)).toBe('67%');
    expect(rate(null)).toBe('—');
  });

  it('reads response times in the unit that fits', () => {
    expect(responseTime(0.25)).toBe('15 min');
    expect(responseTime(3.4)).toBe('3 h');
    expect(responseTime(72)).toBe('3 days');
    expect(responseTime(null)).toBe('—');
  });

  it('says in a full sentence how this week compares with last week', () => {
    expect(weekChange(1, 5)).toEqual({ trend: 'down', text: '4 fewer than last week: buyers posted 5 requests last week and 1 this week.' });
    expect(weekChange(5, 2)).toEqual({ trend: 'up', text: '3 more than last week: buyers posted 2 requests last week and 5 this week.' });
    expect(weekChange(3, 0)).toEqual({ trend: 'up', text: '3 more than last week: buyers posted 0 requests last week and 3 this week.' });
    expect(weekChange(3, 3)).toEqual({ trend: 'flat', text: 'Same as last week: buyers posted 3 requests in each week.' });
    expect(weekChange(1, 1).text).toBe('Same as last week: buyers posted 1 request in each week.');
    expect(weekChange(2, 1).text).toBe('1 more than last week: buyers posted 1 request last week and 2 this week.');
  });

  it('writes a span of days compactly', () => {
    expect(dayRange('2026-10-10', '2026-10-16')).toBe('Oct 10 – 16');
    expect(dayRange('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4');
  });

  it('labels a day without shifting it across time zones', () => {
    expect(shortDay('2026-10-14')).toBe('Oct 14');
  });
});
