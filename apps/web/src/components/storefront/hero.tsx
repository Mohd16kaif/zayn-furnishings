"use client";

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Parallax } from "@/components/motion/parallax";
import { TextReveal } from "@/components/motion/text-reveal";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/design/icons";
import { SmartImage } from "@/components/design/smart-image";

export type HeroSlide = {
  title: string;
  subtitle?: string | null;
  eyebrow?: string | null;
  buttonText?: string | null;
  buttonLink?: string | null;
  secondaryText?: string | null;
  secondaryLink?: string | null;
  image?: string | null;
};

const PREVIEW_SLIDE: HeroSlide = {
  eyebrow: "The Winter Collection · 2026",
  title: "Furniture made to be lived in.",
  subtitle:
    "Thoughtful silhouettes, honest materials, and a quiet sense of warmth. Designed for the way life actually unfolds at home.",
  buttonText: "Shop the collection",
  buttonLink: "#featured",
  secondaryText: "Book a design consult",
  secondaryLink: "#consultation",
};

const AUTO_ADVANCE_MS = 7000;

function HeroCopy({ slide, index }: { slide: HeroSlide; index: number }) {
  return (
    <>
      {slide.eyebrow ? (
        <span className="zf-hero__eyebrow">{slide.eyebrow}</span>
      ) : null}
      <h1
        className="zf-hero__title"
        id="hero-title"
        aria-label={slide.title}
      >
        <TextReveal key={index} text={slide.title} />
      </h1>
      {slide.subtitle ? <p className="zf-hero__sub">{slide.subtitle}</p> : null}
      {slide.buttonText && slide.buttonLink ? (
        <div className="zf-hero__actions">
          <a className="zf-btn zf-btn--primary" href={slide.buttonLink}>
            {slide.buttonText}
            <ArrowRightIcon aria-hidden="true" />
          </a>
          {slide.secondaryText && slide.secondaryLink ? (
            <a className="zf-btn zf-btn--ghost" href={slide.secondaryLink}>
              {slide.secondaryText}
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Homepage hero. Renders statically for a single slide; with two or more it
 * crossfades on a 7s timer that pauses on hover/focus and is disabled when
 * the visitor prefers reduced motion.
 *
 * `image` is used by the design preview (single slide); `slides` takes
 * precedence and is used by the live homepage.
 */
export function Hero({
  image,
  slides,
}: {
  image?: string | null;
  slides?: HeroSlide[];
}) {
  const items =
    slides && slides.length > 0
      ? slides
      : [{ ...PREVIEW_SLIDE, image: image ?? null }];
  const count = items.length;
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const advance = useCallback(
    (direction: -1 | 1) => {
      setActive((current) => {
        const next = current + direction;
        return (next + count) % count;
      });
    },
    [count],
  );

  useEffect(() => {
    if (count < 2 || paused || reduceMotion) {
      return;
    }

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % count);
    }, AUTO_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [count, paused, reduceMotion]);

  const activeIndex = active % count;
  const slide = items[activeIndex];

  return (
    <section
      className="zf-hero"
      aria-labelledby="hero-title"
      aria-roledescription={count > 1 ? "carousel" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Parallax className="zf-hero__media" amount={12}>
        {items.map((item, index) => (
          <div
            className={`zf-hero__slide${index === activeIndex ? " is-active" : ""}`}
            key={`${item.title}-${index}`}
            aria-hidden={index !== activeIndex}
          >
            <SmartImage
              src={item.image ?? undefined}
              alt=""
              sizes="100vw"
              priority={index === 0}
              tone={2}
              label="Hero"
            />
          </div>
        ))}
      </Parallax>
      <div className="zf-hero__overlay" aria-hidden="true" />

      <div className="zf-container zf-hero__inner">
        <div className="zf-hero__copy" aria-live={count > 1 ? "polite" : "off"}>
          <HeroCopy slide={slide} index={activeIndex} />
        </div>
      </div>

      {count > 1 ? (
        <div className="zf-hero__controls">
          <button
            type="button"
            className="zf-round-btn"
            aria-label="Previous slide"
            onClick={() => advance(-1)}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </button>
          <div className="zf-hero__dots">
            {items.map((item, index) => (
              <button
                key={`dot-${item.title}-${index}`}
                type="button"
                className={`zf-hero__dot${index === activeIndex ? " is-active" : ""}`}
                aria-label={`Show slide ${index + 1}: ${item.title}`}
                aria-current={index === activeIndex}
                onClick={() => setActive(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className="zf-round-btn"
            aria-label="Next slide"
            onClick={() => advance(1)}
          >
            <ArrowRightIcon aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <a className="zf-scroll-cue" href="#trust" aria-label="Scroll to explore">
        <span>Explore</span>
        <span className="zf-scroll-cue__line" aria-hidden="true" />
      </a>
    </section>
  );
}
