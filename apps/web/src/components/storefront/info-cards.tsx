import { Reveal } from "@/components/motion/reveal";
import { ArrowRightIcon } from "@/components/design/icons";

export type InfoCard = {
  title: string;
  body: string;
  linkUrl?: string | null;
  linkText?: string | null;
};

export function InfoCards({ cards }: { cards: InfoCard[] }) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section
      className="zf-section zf-section--soft"
      id="more"
      aria-labelledby="more-title"
    >
      <div className="zf-container">
        <Reveal className="zf-section-head" variant="fade">
          <div className="zf-section-head__copy">
            <span className="zf-eyebrow">More ways to shop</span>
            <h2 className="zf-heading" id="more-title">
              Helpful before you commit.
            </h2>
          </div>
        </Reveal>

        <div className="zf-info-grid">
          {cards.map((card, index) => (
            <Reveal
              className="zf-info-card"
              variant="rise"
              delay={index * 0.06}
              key={card.title}
            >
              <h3 className="zf-info-card__title">{card.title}</h3>
              <p className="zf-info-card__body">{card.body}</p>
              {card.linkUrl ? (
                <a className="zf-info-card__link" href={card.linkUrl}>
                  {card.linkText ?? "Learn more"}
                  <ArrowRightIcon aria-hidden="true" />
                </a>
              ) : null}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
