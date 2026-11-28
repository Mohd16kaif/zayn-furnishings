"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/motion/reveal";
import { SmartImage } from "@/components/design/smart-image";

export type CraftStat = {
  value: number;
  suffix?: string;
  label: string;
};

function CountUp({ value, suffix = "", label }: CraftStat) {
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

/**
 * Collection facts section. `stats` must contain facts the storefront can
 * compute (active product count, collection count), never unverified claims.
 */
export function Craft({
  image,
  stats,
}: {
  image?: string | null;
  stats: CraftStat[];
}) {
  return (
    <section className="zf-section" id="craft" aria-labelledby="craft-title">
      <div className="zf-container">
        <div className="zf-craft">
          <Reveal variant="scaleIn">
            <div className="zf-craft__media">
              <SmartImage
                src={image ?? undefined}
                alt=""
                sizes="(max-width: 1023px) 92vw, 46vw"
                tone={4}
                label="Collection"
              />
            </div>
          </Reveal>

          <Reveal className="zf-craft__copy" delay={0.08}>
            <span className="zf-eyebrow">At a glance</span>
            <h2 className="zf-heading" id="craft-title">
              The collection in numbers.
            </h2>
            {stats.length > 0 ? (
              <div className="zf-craft__stats">
                {stats.map((stat) => (
                  <CountUp key={stat.label} {...stat} />
                ))}
              </div>
            ) : null}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
