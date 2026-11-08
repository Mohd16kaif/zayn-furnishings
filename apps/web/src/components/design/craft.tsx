"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/motion/reveal";
import { SmartImage } from "./smart-image";

type Stat = {
  value: number;
  suffix: string;
  label: string;
};

const stats: Stat[] = [
  { value: 10, suffix: "yr", label: "Frame warranty" },
  { value: 100, suffix: "%", label: "Hand-finished details" },
  { value: 100, suffix: "%", label: "Delivered to your room" },
];

function CountUp({ value, suffix, label }: Stat) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) {
      return;
    }

    let frameId = 0;
    const start = performance.now();
    const duration = 1500;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(value * eased));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [inView, reduceMotion, value]);

  const display = reduceMotion ? value : count;

  return (
    <div ref={ref}>
      <span className="zf-stat__value">
        {display}
        <span>{suffix}</span>
      </span>
      <span className="zf-stat__label">{label}</span>
    </div>
  );
}

export function Craft({ image }: { image: string | null }) {
  return (
    <section className="zf-section" id="craft" aria-labelledby="craft-title">
      <div className="zf-container">
        <div className="zf-craft">
          <Reveal variant="scaleIn">
            <div className="zf-craft__media">
              <SmartImage
                src={image ?? undefined}
                alt="A craftsperson hand-finishing a walnut furniture frame"
                sizes="(max-width: 1023px) 92vw, 46vw"
                tone={4}
                label="The craft"
              />
            </div>
          </Reveal>

          <Reveal className="zf-craft__copy" delay={0.08}>
            <span className="zf-eyebrow">Made slowly, made well</span>
            <h2 className="zf-heading" id="craft-title">
              The craft behind every piece.
            </h2>
            <p className="zf-lede">
              We work with a small circle of workshops who still measure,
              join, and finish by hand. Frames are kiln-dried and corner
              blocked for decades of everyday use. Fabrics are chosen for the
              way they soften with time, not just the way they photograph.
            </p>
            <p className="zf-lede">
              The result is furniture with presence, but without noise.
              Pieces that settle into a room and quietly become part of the
              family.
            </p>
            <div className="zf-craft__stats">
              {stats.map((stat) => (
                <CountUp key={stat.label} {...stat} />
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
