import { useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

type RevealFrom = 'up' | 'left' | 'right';

const offsets: Record<RevealFrom, { x: number; y: number }> = {
  up: { x: 0, y: 12 },
  left: { x: -16, y: 0 },
  right: { x: 16, y: 0 },
};

export function Reveal({ children, delay = 0, className, from = 'up', once = false }: { children: ReactNode; delay?: number; className?: string; from?: RevealFrom; once?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { x, y } = offsets[from];
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(root.current, { x, y, opacity: 0, duration: .4, delay, ease: 'power2.out',
        scrollTrigger: { trigger: root.current, start: 'top 96%', once, toggleActions: once ? 'play none none none' : 'play none none reverse' } });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [x, y, delay, once], revertOnUpdate: true });
  return <div ref={root} className={className}>{children}</div>;
}
