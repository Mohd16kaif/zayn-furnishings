import { Parallax } from "@/components/motion/parallax";
import { TextReveal } from "@/components/motion/text-reveal";
import { ArrowRightIcon } from "./icons";
import { SmartImage } from "./smart-image";

export function Hero({ image }: { image: string | null }) {
  return (
    <section className="zf-hero" aria-labelledby="hero-title">
      <Parallax className="zf-hero__media" amount={12}>
        <SmartImage
          src={image ?? undefined}
          alt="A warm, sunlit living room with a sculptural sofa and walnut tables"
          sizes="100vw"
          priority
          tone={2}
          label="Hero"
        />
      </Parallax>
      <div className="zf-hero__overlay" aria-hidden="true" />

      <div className="zf-container zf-hero__inner">
        <div className="zf-hero__copy">
          <span className="zf-hero__eyebrow">The Winter Collection · 2026</span>
          <h1 className="zf-hero__title" id="hero-title">
            <TextReveal text="Furniture made to be lived in." />
          </h1>
          <p className="zf-hero__sub">
            Thoughtful silhouettes, honest materials, and a quiet sense of
            warmth. Designed for the way life actually unfolds at home.
          </p>
          <div className="zf-hero__actions">
            <a className="zf-btn zf-btn--primary" href="#featured">
              Shop the collection
              <ArrowRightIcon aria-hidden="true" />
            </a>
            <a className="zf-btn zf-btn--ghost" href="#consultation">
              Book a design consult
            </a>
          </div>
        </div>
      </div>

      <a className="zf-scroll-cue" href="#trust" aria-label="Scroll to explore">
        <span>Explore</span>
        <span className="zf-scroll-cue__line" aria-hidden="true" />
      </a>
    </section>
  );
}
