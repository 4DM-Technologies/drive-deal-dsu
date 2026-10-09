import type { SVGProps } from 'react';

const SIDE = 7.2;
const RADIUS = 2.5;
/** Petal centres on a 24 grid — the same top / right / bottom / left layout as the SerraLogo mark. */
const PETALS = [
  { cx: 12, cy: 6 },
  { cx: 18, cy: 12 },
  { cx: 12, cy: 18 },
  { cx: 6, cy: 12 },
];

/**
 * Sera's mark as a flat icon: four rounded diamonds around a centre, like the SerraLogo without the
 * animated gradient. Solid, so it stays readable at small sizes, and it inherits the current text colour.
 */
export function SerraIcon({ size = 16, ...props }: { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
    {PETALS.map(({ cx, cy }) => <rect key={`${cx}-${cy}`} x={cx - SIDE / 2} y={cy - SIDE / 2} width={SIDE} height={SIDE} rx={RADIUS} transform={`rotate(45 ${cx} ${cy})`} />)}
  </svg>;
}
