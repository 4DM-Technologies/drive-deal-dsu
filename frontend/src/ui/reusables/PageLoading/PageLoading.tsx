import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';

/** Sera's mark with a progress outline running around it. */
export function SerraLoader({ size = 64, label = 'Loading' }: { size?: number; label?: string }) {
  const frame = size + 24;
  return <span className="serra-loader" role="status" aria-label={label} style={{ width: frame, height: frame }}>
    <svg className="serra-loader-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="serra-loader-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1765d5" /><stop offset="1" stopColor="#70a8ff" /></linearGradient>
      </defs>
      <circle className="serra-loader-track" cx="50" cy="50" r="46" />
      <circle className="serra-loader-arc" cx="50" cy="50" r="46" pathLength="100" />
    </svg>
    <SerraLogo size={size} title={null} />
  </span>;
}

/** Page-level loader: just the logo, centred, while a screen's data arrives. `label` is read out to screen readers only. */
export function PageLoading({ label }: { label: string }) {
  return <div className="shell page-loader" aria-busy="true"><SerraLoader size={40} label={label} /></div>;
}

/** Full-viewport loader for the session check, before any page shell exists. */
export function FullScreenLoader({ label = 'Securing your session' }: { label?: string }) {
  return <div className="fullscreen-loader" aria-busy="true"><SerraLoader size={40} label={label} /></div>;
}
