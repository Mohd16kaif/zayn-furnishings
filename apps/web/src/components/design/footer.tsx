"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { PublicCategoryNode, PublicStoreSettings } from "@zayn/shared";
import { ArrowRightIcon } from "./icons";

type FooterProps = {
  categories: PublicCategoryNode[];
  settings: PublicStoreSettings;
};

type FooterLink = { label: string; href: string };

function FooterYear() {
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setYear(new Date().getFullYear());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return <>{year}</>;
}

function companyLinks(): FooterLink[] {
  return [
    { label: "Our Story", href: "/about" },
    { label: "Craftsmanship", href: "/about" },
    { label: "Design Services", href: "/contact" },
    { label: "Trade Program", href: "/contact" },
    { label: "Journal", href: "/about" },
    { label: "Careers", href: "/contact" },
  ];
}

function careLinks(): FooterLink[] {
  return [
    { label: "Delivery & Assembly", href: "/delivery" },
    { label: "Returns", href: "/returns" },
    { label: "Care Guide", href: "/faq" },
    { label: "Warranty", href: "/faq" },
    { label: "Contact", href: "/contact" },
    { label: "FAQ", href: "/faq" },
  ];
}

function legalLinks(): FooterLink[] {
  return [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Accessibility", href: "/accessibility" },
  ];
}

export function Footer({ categories, settings }: FooterProps) {
  const [subscribed, setSubscribed] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscribed(true);
    // TODO(checkout-phase): POST the email to a newsletter endpoint once the
    // marketing signup exists. The client-side message is the only feedback
    // until then.
  }

  const saleCategory = categories.find(
    (category) => category.slug === "sale" || category.slug === "deals",
  );

  const shopLinks: FooterLink[] = [
    ...categories
      .slice(0, 6)
      .map((category) => ({ label: category.name, href: `/c/${category.slug}` })),
    ...(saleCategory
      ? [{ label: "Sale", href: `/c/${saleCategory.slug}` } as FooterLink]
      : []),
  ];

  const shopColumn: { title: string; links: FooterLink[] } | null =
    shopLinks.length > 0 ? { title: "Shop", links: shopLinks } : null;

  const columns: Array<{ title: string; links: FooterLink[] }> = [
    ...(shopColumn ? [shopColumn] : []),
    { title: "Company", links: companyLinks() },
    { title: "Care", links: careLinks() },
    { title: "Legal", links: legalLinks() },
  ];

  return (
    <footer className="zf-footer" id="footer">
      <div className="zf-footer__ghost" aria-hidden="true">
        ZAYN
      </div>

      <div className="zf-container">
        <div className="zf-footer__inner">
          <div className="zf-footer__brand">
            <Link className="zf-footer__logo" href="/" aria-label="Zayn Furnishings home">
              <span>ZAYN</span>
              <span>Furnishings</span>
            </Link>
            <p className="zf-footer__blurb">
              Quiet luxury for the American home. Made with honest materials,
              built by hand, and delivered with care.
            </p>
            {settings.show_financing ? (
              <p className="zf-footer__financing">
                Monthly financing available.
              </p>
            ) : null}
            <div className="zf-footer__social">
              <a href="#footer" aria-label="Instagram">Instagram</a>
              <a href="#footer" aria-label="Pinterest">Pinterest</a>
              <a href="#footer" aria-label="Journal">Journal</a>
            </div>
          </div>

          {columns.map((column) => (
            <div className="zf-footer__col" key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link href={link.href}>{link.label}</Link>
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
            {settings.phone ? (
              <p className="zf-footer__contact">
                <a href={`tel:+1${settings.phone.replace(/\D/g, "")}`}>
                  {settings.phone}
                </a>
              </p>
            ) : null}
            {settings.email ? (
              <p className="zf-footer__contact">
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              </p>
            ) : null}
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
              {subscribed ? "Thanks, we will be in touch." : ""}
            </p>
          </div>
        </div>

        <div className="zf-footer__bottom">
          <p className="zf-footer__legal">
            &copy; <FooterYear /> {settings.store_name}.
          </p>
        </div>
      </div>
    </footer>
  );
}
