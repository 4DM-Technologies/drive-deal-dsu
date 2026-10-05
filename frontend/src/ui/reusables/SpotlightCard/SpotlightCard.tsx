import type { ReactNode } from 'react';

/** Tracks the pointer in --mx / --my so a card's CSS can draw a spotlight that follows the cursor. */
export function SpotlightCard({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={className}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`);
        event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`);
      }}
    >
      {children}
    </div>
  );
}
