"use client";

import { useState } from "react";
import { faqs as previewFaqs } from "@/app/design-preview/preview-data";
import { Reveal } from "@/components/motion/reveal";

export type FaqItem = {
  question: string;
  answer: string;
};

const PREVIEW_FAQS: FaqItem[] = previewFaqs.map((faq) => ({
  question: faq.question,
  answer: faq.answer,
}));

export function Faq({ faqs = PREVIEW_FAQS }: { faqs?: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (faqs.length === 0) {
    return null;
  }

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
              Everything you need to feel confident before, during, and after
              delivery. Still wondering about something? Our team is a note
              away.
            </p>
            <a className="zf-btn zf-btn--ghost" href="mailto:hello@zaynfurnishings.example">
              Ask a question
            </a>
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
