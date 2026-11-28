import { Reveal } from "@/components/motion/reveal";
import { ArrowRightIcon } from "@/components/design/icons";
import { SmartImage } from "@/components/design/smart-image";

export type PromoCard = {
  eyebrow?: string | null;
  title: string;
  body?: string | null;
  buttonText?: string | null;
  linkUrl?: string | null;
  image?: string | null;
};

export function Promo({
  image,
  card,
}: {
  image?: string | null;
  card: PromoCard;
}) {
  const background = card.image ?? image ?? null;

  return (
    <section className="zf-promo" id="consultation" aria-labelledby="promo-title">
      {background ? (
        <div className="zf-promo__bg" aria-hidden="true">
          <SmartImage
            src={background}
            alt=""
            sizes="100vw"
            tone={3}
            label="Showcase"
          />
        </div>
      ) : null}
      <div className="zf-container">
        <Reveal variant="scaleIn">
          <div className="zf-promo__inner">
            {card.eyebrow ? (
              <span className="zf-promo__eyebrow">{card.eyebrow}</span>
            ) : null}
            <h2 className="zf-promo__title" id="promo-title">
              {card.title}
            </h2>
            {card.body ? <p className="zf-promo__copy">{card.body}</p> : null}
            {card.buttonText && card.linkUrl ? (
              <a className="zf-btn zf-btn--champagne" href={card.linkUrl}>
                {card.buttonText}
                <ArrowRightIcon aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
