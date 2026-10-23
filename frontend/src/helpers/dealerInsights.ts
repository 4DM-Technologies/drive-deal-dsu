/** Formatting for the dealer overview's market insights, kept here so the wording is tested and consistent. */

/**
 * Which rows a collapsed list shows: the first `keep` (rows come largest first), plus any further row `pinned` says
 * must stay visible, such as the dealer's own brands. Order is kept, so pinned rows sit where they rank.
 */
export function visibleRows<T>(rows: readonly T[], keep: number, pinned: (row: T) => boolean = () => false): T[] {
  return rows.filter((row, index) => index < keep || pinned(row));
}

/** A share as a whole percent ("40%"), or an em dash when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

/** A 0–1 rate as a whole percent, or an em dash when it isn't known yet. */
export function rate(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** A response time people read at a glance: minutes under an hour, hours under two days, then days. */
export function responseTime(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

export type Trend = 'up' | 'down' | 'flat';

/**
 * This week (the last 7 days) against last week (the 7 before), as a plain sentence anyone can read: how much it went
 * up or down, then what buyers posted in each week. The trend sets the arrow beside it.
 */
export function weekChange(current: number, previous: number): { trend: Trend; text: string } {
  const requests = (count: number) => `${count} ${count === 1 ? 'request' : 'requests'}`;
  if (current === previous) return { trend: 'flat', text: `Same as last week: buyers posted ${requests(current)} in each week.` };
  const trend: Trend = current > previous ? 'up' : 'down';
  const difference = Math.abs(current - previous);
  return { trend, text: `${difference} ${trend === 'up' ? 'more' : 'fewer'} than last week: buyers posted ${requests(previous)} last week and ${current} this week.` };
}

/** A span of days, compact: "Oct 10 – 16" in one month, "Sep 28 – Oct 4" across two. */
export function dayRange(firstIsoDate: string, lastIsoDate: string): string {
  const first = shortDay(firstIsoDate);
  const last = shortDay(lastIsoDate);
  const [firstMonth] = first.split(' ');
  const [lastMonth, lastDay] = last.split(' ');
  return firstMonth === lastMonth ? `${first} – ${lastDay}` : `${first} – ${lastMonth} ${lastDay}`;
}

/** "Oct 14" for a "2026-10-14" day, read as that calendar day (not shifted by the viewer's time zone). */
export function shortDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
