"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/reveal";

export type FaqItem = {
  question: string;
  answer: string;
};

export function Faq({
  faqs,
  email,
  phone,
}: {
  faqs: FaqItem[];
  email: string;
  phone: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (faqs.length === 0) {
    return null;
  }

  const phoneHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <section className="zf-section" id="faq" aria-labelledby="faq-title">
      <div className="zf-container">
        <div className="zf-faq">
          <Reveal className="zf-faq__intro" variant="rise">
            <span className="zf-eyebrow">Good to know</span>
            <h2 className="zf-heading" id="faq-title">
              Questions, answered quietly.
            </h2>
            <p className="zf-lede">
              Browse the questions below.
            </p>
            {email ? (
              <a className="zf-btn zf-btn--ghost" href={`mailto:${email}`}>
                Ask a question
              </a>
            ) : phoneHref ? (
              <a className="zf-btn zf-btn--ghost" href={phoneHref}>
                Call us
              </a>
            ) : null}
          </Reveal>

          <Reveal className="zf-faq__list" variant="fade" delay={0.06}>
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              const panelId = `faq-panel-${index}`;
              const buttonId = `faq-button-${index}`;

              return (
                <div
                  className={`zf-faq__item${isOpen ? " is-open" : ""}`}
                  key={`${faq.question}-${index}`}
                >
                  <h3>
                    <button
                      type="button"
                      className="zf-faq__question"
                      id={buttonId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(isOpen ? null : index)}
                    >
                      {faq.question}
                      <span className="zf-faq__icon" aria-hidden="true" />
                    </button>
                  </h3>
                  <div
                    className="zf-faq__answer"
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                  >
                    <div className="zf-faq__answer-inner">
                      <p>{faq.answer}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
