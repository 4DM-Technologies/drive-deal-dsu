import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

type RevealFrom = 'up' | 'left' | 'right';

const offsets: Record<RevealFrom, { x: number; y: number }> = {
  up: { x: 0, y: 16 },
  left: { x: -56, y: 0 },
  right: { x: 56, y: 0 },
};

export function Reveal({ children, delay = 0, className, from = 'up', once = false }: { children: ReactNode; delay?: number; className?: string; from?: RevealFrom; once?: boolean }) {
  const reduceMotion = useReducedMotion();
  const { x, y } = offsets[from];
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, x, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once, amount: .18, margin: '-4% 0px -4% 0px' }}
      transition={{ duration: from === 'up' ? .42 : .7, delay, ease: [.16, 1, .3, 1] }}
    >
      {children}
    </motion.div>
  );
}
