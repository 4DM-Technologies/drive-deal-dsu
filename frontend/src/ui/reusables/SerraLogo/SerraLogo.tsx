import { useId } from 'react';
import type { CSSProperties } from 'react';
import './SerraLogo.css';

interface SerraLogoProps {
  /** Rendered width and height in px. The artwork is drawn at true size, so it stays crisp. */
  size?: number;
  /** Turn the flowing colour, drift and sheen animation off (e.g. for dense lists). */
  animated?: boolean;
  /** Accessible name. Pass `null` when the logo is purely decorative. */
  title?: string | null;
  className?: string;
}

const PETALS = [
  { x: 108, y: 28, cx: 160, cy: 80 },
  { x: 188, y: 108, cx: 240, cy: 160 },
  { x: 108, y: 188, cx: 160, cy: 240 },
  { x: 28, y: 108, cx: 80, cy: 160 },
];

const SPECULARS = [
  { cx: 160, cy: 52 },
  { cx: 232, cy: 132 },
  { cx: 150, cy: 214 },
  { cx: 72, cy: 132 },
];

/**
 * Sera's animated mark in the Deal&Drive palette: four rounded diamonds filled with a slowly
 * turning navy → blue → white gradient, with a blue rim and a passing sheen.
 */
export function SerraLogo({ size = 48, animated = true, title = 'Sera', className = '' }: SerraLogoProps) {
  const uid = useId().replace(/:/g, '');
  const clipId = `serra-petals-${uid}`;
  const clipSvgId = `serra-petals-svg-${uid}`;
  const rimId = `serra-rim-${uid}`;
  const specId = `serra-spec-${uid}`;
  const style = { '--serra-size': `${size}px`, '--serra-k': size / 320 } as CSSProperties;

  return <span className={`serra-logo ${animated ? 'is-animated' : ''} ${className}`.trim()} style={style} role={title ? 'img' : undefined} aria-label={title ?? undefined} aria-hidden={title ? undefined : true}>
    <svg width="0" height="0" className="serra-logo-defs" aria-hidden="true" focusable="false">
      <clipPath id={clipId} clipPathUnits="objectBoundingBox">
        {PETALS.map((petal) => <rect key={petal.x + '-' + petal.y} x={petal.x / 320} y={petal.y / 320} width={104 / 320} height={104 / 320} rx={36 / 320} transform={`rotate(45 ${petal.cx / 320} ${petal.cy / 320})`} />)}
      </clipPath>
    </svg>
    <span className="serra-logo-mark">
      <span className="serra-logo-flow" style={{ clipPath: `url(#${clipId})` }} />
      <span className="serra-logo-sheen" style={{ clipPath: `url(#${clipId})` }} />
      <svg className="serra-logo-rims" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={rimId} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#E8F0FC" /><stop offset="0.4" stopColor="#4A8DF0" /><stop offset="1" stopColor="#0D438F" /></linearGradient>
          <radialGradient id={specId} cx="35%" cy="26%" r="55%"><stop offset="0" stopColor="#fff" stopOpacity=".8" /><stop offset="0.55" stopColor="#fff" stopOpacity=".1" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
          <clipPath id={clipSvgId} clipPathUnits="userSpaceOnUse">
            {PETALS.map((petal) => <rect key={petal.x + '-' + petal.y} x={petal.x} y={petal.y} width="104" height="104" rx="36" transform={`rotate(45 ${petal.cx} ${petal.cy})`} />)}
          </clipPath>
        </defs>
        <g fill="none">
          {PETALS.map((petal) => <g key={petal.x + '-' + petal.y} transform={`rotate(45 ${petal.cx} ${petal.cy})`}>
            <rect x={petal.x} y={petal.y} width="104" height="104" rx="36" stroke={`url(#${rimId})`} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <rect x={petal.x + 2} y={petal.y + 2} width="100" height="100" rx="34" stroke="#E8F0FC" strokeOpacity=".5" strokeWidth=".75" vectorEffect="non-scaling-stroke" />
          </g>)}
          <g clipPath={`url(#${clipSvgId})`}>
            {SPECULARS.map((spec) => <ellipse key={spec.cx + '-' + spec.cy} cx={spec.cx} cy={spec.cy} rx="30" ry="14" fill={`url(#${specId})`} />)}
          </g>
        </g>
      </svg>
    </span>
  </span>;
}
