"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

const easing = [0.22, 1, 0.36, 1] as const;

const container: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.045, delayChildren: 0.08 },
  },
};

const wordVariants: Variants = {
  hidden: { y: "112%", opacity: 0.001 },
  visible: {
    y: "0%",
    opacity: 1,
    transition: { duration: 0.8, ease: easing },
  },
};

export function TextReveal({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const words = text.split(/\s+/).filter(Boolean);

  if (reduceMotion) {
    return <span className={className}>{text}</span>;
  }

  return (
    <motion.span
      className={className}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-10%" }}
    >
      <span className="zf-sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <span key={`${word}-${index}`}>
            <span className="zf-text-reveal__word">
              <motion.span variants={wordVariants}>{word}</motion.span>
            </span>
            {index < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    </motion.span>
  );
}
