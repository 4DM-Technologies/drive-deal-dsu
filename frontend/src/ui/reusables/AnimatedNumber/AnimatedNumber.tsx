import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

/** Springs from 0 to `value` once `active`, and follows later changes. `format` must be a stable (module-level) function. */
export function AnimatedNumber({ value, format, active = true }: { value: number; format: (value: number) => string; active?: boolean }) {
  const reduceMotion = useReducedMotion();
  const target = useMotionValue(0);
  const spring = useSpring(target, { stiffness: 110, damping: 24, mass: .8 });
  const text = useTransform(spring, format);
  useEffect(() => { target.set(active ? value : 0); }, [active, value, target]);
  if (reduceMotion) return <span>{format(value)}</span>;
  return <motion.span>{text}</motion.span>;
}
