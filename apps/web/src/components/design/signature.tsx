import { Reveal } from "@/components/motion/reveal";
import { TextReveal } from "@/components/motion/text-reveal";

export function Signature() {
  return (
    <section className="zf-section zf-section--soft zf-signature" id="philosophy">
      <div className="zf-container">
        <Reveal className="zf-signature__inner" variant="fade">
          <span className="zf-gold-rule" aria-hidden="true" />
          <span className="zf-eyebrow zf-eyebrow--center">Our philosophy</span>
          <p className="zf-signature__text">
            <TextReveal text="We believe the best rooms are not decorated. They are lived in, layered slowly, and made to last." />
          </p>
        </Reveal>
      </div>
    </section>
  );
}
