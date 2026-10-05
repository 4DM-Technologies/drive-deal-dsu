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
