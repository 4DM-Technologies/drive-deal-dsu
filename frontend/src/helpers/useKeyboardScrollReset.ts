import { useEffect } from 'react';

const FIELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * Full-height chat pages never scroll the window; only their inner threads do. Mobile browsers still scroll the
 * window to keep a focused field above the keyboard, and leave it scrolled once the keyboard closes, which hides
 * the page header. This puts the window back at the top as soon as the keyboard is gone.
 */
export function useKeyboardScrollReset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let fullHeight = viewport?.height ?? window.innerHeight;
    let timer: number | undefined;
    const reset = () => {
      if (window.scrollY !== 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    const resetSoon = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reset, delay);
    };
    // The keyboard has closed once the visible area is back to (nearly) its full height.
    const onViewportResize = () => {
      if (!viewport) return;
      fullHeight = Math.max(fullHeight, viewport.height);
      if (viewport.height >= fullHeight - 80) resetSoon(60);
    };
    // Leaving a field (send, back, tapping elsewhere) closes the keyboard unless focus went straight to another field.
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.matches(FIELD)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!document.activeElement?.matches(FIELD)) reset(); }, 150);
    };
    const onOrientationChange = () => { fullHeight = 0; };
    viewport?.addEventListener('resize', onViewportResize);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', onOrientationChange);
    return () => {
      viewport?.removeEventListener('resize', onViewportResize);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('orientationchange', onOrientationChange);
      window.clearTimeout(timer);
    };
  }, []);
}
