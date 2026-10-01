import type { SVGProps } from 'react';

/** Two opposing arrows joined in an S-curve — the "compare" mark. Inherits the current text colour. */
export function CompareIcon({ size = 16, strokeWidth = 2.1, ...props }: { size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d="M10.3 12.4V11.6a2.6 2.6 0 0 1 2.6-2.6H20.6" />
    <path d="M17.6 6.4 20.6 9.4 17.6 12.4" />
    <path d="M13.7 13.6a2.6 2.6 0 0 1-2.6 2.6H3.4" />
    <path d="M6.4 13.7 3.4 16.7 6.4 19.7" />
  </svg>;
}
