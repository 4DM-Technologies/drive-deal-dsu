/** Scroll behaviour for `scrollIntoView`: smooth, unless the visitor has asked their system for reduced motion. */
export const smoothScroll = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
