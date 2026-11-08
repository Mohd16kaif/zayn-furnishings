"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const reduceMotion = useReducedMotion();
  const spring = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.18,
  });

  return (
    <motion.div
      aria-hidden="true"
      className="zf-progress"
      style={{ scaleX: reduceMotion ? scrollYProgress : spring }}
    />
  );
}
