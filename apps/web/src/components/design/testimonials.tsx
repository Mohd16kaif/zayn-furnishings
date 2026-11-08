import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { testimonials } from "@/app/design-preview/preview-data";
import { StarIcon } from "./icons";

export function Testimonials() {
  return (
    <section
      className="zf-section zf-section--soft"
      id="testimonials"
      aria-labelledby="testimonials-title"
    >
      <div className="zf-container">
        <Reveal className="zf-section-head" variant="fade">
          <div className="zf-section-head__copy">
            <span className="zf-eyebrow">In their words</span>
            <h2 className="zf-heading" id="testimonials-title">
              Lived in, loved, and kept for years.
            </h2>
          </div>
          <p className="zf-lede" style={{ maxWidth: 350 }}>
            Sample testimonials for the design preview. Real reviews will be
            verified and connected to each product.
          </p>
        </Reveal>

        <RevealGroup className="zf-testimonials" stagger={0.12}>
          {testimonials.map((testimonial) => (
            <RevealItem key={`${testimonial.name}-${testimonial.meta}`}>
              <figure className="zf-quote">
                <span className="zf-quote__mark" aria-hidden="true">
                  &ldquo;
                </span>
                <div className="zf-stars" aria-label="5 out of 5 stars">
                  {[0, 1, 2, 3, 4].map((star) => (
                    <StarIcon key={star} />
                  ))}
                </div>
                <blockquote className="zf-quote__text">
                  {testimonial.quote}
                </blockquote>
                <figcaption className="zf-quote__footer">
                  <span className="zf-quote__avatar" aria-hidden="true">
                    {testimonial.initials}
                  </span>
                  <span>
                    <span className="zf-quote__name">{testimonial.name}</span>
                    <span className="zf-quote__meta">{testimonial.meta}</span>
                  </span>
                </figcaption>
              </figure>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
