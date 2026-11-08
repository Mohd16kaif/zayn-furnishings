"use client";

import { useState, type FormEvent } from "react";
import {
  footerColumns,
  paymentLabels,
} from "@/app/design-preview/preview-data";
import { ArrowRightIcon } from "./icons";

export function Footer() {
  const [subscribed, setSubscribed] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscribed(true);
  }

  return (
    <footer className="zf-footer" id="footer">
      <div className="zf-footer__ghost" aria-hidden="true">
        ZAYN
      </div>

      <div className="zf-container">
        <div className="zf-footer__inner">
          <div className="zf-footer__brand">
            <a className="zf-footer__logo" href="#top" aria-label="Zayn Furnishings home">
              <span>ZAYN</span>
              <span>Furnishings</span>
            </a>
            <p className="zf-footer__blurb">
              Quiet luxury for the American home. Made with honest materials,
              built by hand, and delivered with care.
            </p>
            <div className="zf-footer__social">
              <a href="#top">Instagram</a>
              <a href="#top">Pinterest</a>
              <a href="#top">Journal</a>
            </div>
          </div>

          {footerColumns.map((column) => (
            <div className="zf-footer__col" key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link}>
                    <a href="#top">{link}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="zf-footer__news">
            <h3>A quieter inbox.</h3>
            <p>
              New collections, studio notes, and early access. No noise, and
              never more than twice a month.
            </p>
            <form className="zf-newsletter" onSubmit={onSubmit}>
              <label className="zf-sr-only" htmlFor="zf-newsletter-email">
                Email address
              </label>
              <input
                id="zf-newsletter-email"
                name="email"
                type="email"
                required
                placeholder="Email address"
                autoComplete="email"
              />
              <button type="submit" aria-label="Subscribe to the newsletter">
                <ArrowRightIcon aria-hidden="true" />
              </button>
            </form>
            <p aria-live="polite" style={{ marginTop: 10, minHeight: 18 }}>
              {subscribed ? "Thank you — this is a sample confirmation." : ""}
            </p>
          </div>
        </div>

        <div className="zf-footer__bottom">
          <p className="zf-footer__legal">
            &copy; 2026 Zayn Furnishings. Design preview only. Sample content,
            names, and pricing.
          </p>
          <ul className="zf-footer__payments" aria-label="Accepted payment methods">
            {paymentLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
