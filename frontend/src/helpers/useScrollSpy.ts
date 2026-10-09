import { useEffect, useState } from 'react';

/** Where the "current section" line sits, as a share of the viewport height measured from the top. */
const PROBE = .35;

/**
 * Scroll-spy for in-page nav links. `sections` maps a section's element id to the key of the nav link it belongs to,
 * so several sections can share one link. Returns the key of the link whose section is under the probe line, or null
 * while the visitor is over content no link points at (hero, closing banners, footer).
 * Pass a module-level constant: a new object each render would re-subscribe on every render.
 */
export function useScrollSpy(sections: Readonly<Record<string, string>>): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const entries = Object.entries(sections);
    let frame = 0;
    const update = () => {
      frame = 0;
      const probe = window.innerHeight * PROBE;
      let current: string | null = null;
      for (const [id, key] of entries) {
        const rect = document.getElementById(id)?.getBoundingClientRect();
        if (rect && rect.top <= probe && rect.bottom > probe) { current = key; break; }
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [sections]);

  return active;
}

/** Props for a header `.nav-link` anchor: the highlighted `is-active` look plus `aria-current` while its section is on screen. */
export function spyLinkProps(active: string | null, key: string) {
  const current = active === key;
  return { className: `nav-link${current ? ' is-active' : ''}`, 'aria-current': current ? ('location' as const) : undefined };
}
