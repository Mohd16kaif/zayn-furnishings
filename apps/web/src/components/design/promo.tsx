import { Reveal } from "@/components/motion/reveal";
import { ArrowRightIcon } from "./icons";
import { SmartImage } from "./smart-image";

export function Promo({ image }: { image: string | null }) {
  return (
    <section className="zf-promo" id="consultation" aria-labelledby="promo-title">
      {image ? (
        <div className="zf-promo__bg" aria-hidden="true">
          <SmartImage src={image} alt="" sizes="100vw" tone={3} label="Showcase" />
        </div>
      ) : null}
      <div className="zf-container">
        <Reveal variant="scaleIn">
          <div className="zf-promo__inner">
            <span className="zf-promo__eyebrow">By appointment · January</span>
            <h2 className="zf-promo__title" id="promo-title">
              Winter Showcase
            </h2>
            <p className="zf-promo__copy">
              A private preview of new silhouettes, limited-run weaves, and
              one-of-a-kind walnut pieces. Meet our design team and plan your
              next room over a quiet hour in the studio.
            </p>
            <a className="zf-btn zf-btn--champagne" href="#footer">
              Reserve your consultation
              <ArrowRightIcon aria-hidden="true" />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
