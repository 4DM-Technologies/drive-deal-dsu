import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: .18, margin: '-4% 0px -4% 0px' }}
      transition={{ duration: .42, delay, ease: [.16, 1, .3, 1] }}
    >
      {children}
    </motion.div>
  );
}
