export function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  const unit = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1];
  if (!unit) return 'now';
  return formatter.format(Math.round(seconds / unit[1]), unit[0]);
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

/** Whole days until `value`, rounded up, so the last partial day still counts as one day left. */
export function daysUntil(value: string): number {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}
