"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicCategoryNode, PublicStoreSettings } from "@zayn/shared";
import { FEATURES } from "@/config/features";
import { NewsletterForm } from "@/components/storefront/newsletter-form";

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

function uniqueLinks(links: FooterLink[]): FooterLink[] {
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.href)) {
      return false;
    }

    seen.add(link.href);
    return true;
  });
}

function companyLinks(): FooterLink[] {
  return [
    { label: "Our Story", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];
}

function careLinks(): FooterLink[] {
  return [
    { label: "Delivery", href: "/delivery" },
    { label: "Returns", href: "/returns" },
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
  const saleCategory = categories.find(
    (category) => category.slug === "sale" || category.slug === "deals",
  );

  const shopLinks = uniqueLinks([
    ...categories
      .slice(0, 6)
      .map((category) => ({
        label: category.name,
        href: `/c/${category.slug}`,
      })),
    ...(saleCategory
      ? [{ label: "Sale", href: `/c/${saleCategory.slug}` }]
      : []),
  ]);

  const shopColumn: { title: string; links: FooterLink[] } | null =
    shopLinks.length > 0 ? { title: "Shop", links: shopLinks } : null;

  const columns: Array<{ title: string; links: FooterLink[] }> = [
    ...(shopColumn ? [shopColumn] : []),
    { title: "Company", links: companyLinks() },
    { title: "Care", links: careLinks() },
    { title: "Legal", links: legalLinks() },
  ];

  const hasContact = Boolean(settings.phone || settings.email);
  const showFooterBlock = FEATURES.newsletter || hasContact;
  const phoneHref = settings.phone
    ? `tel:${settings.phone.replace(/[^\d+]/g, "")}`
    : null;

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
              Furniture for the American home.
            </p>
            {settings.show_financing ? (
              <p className="zf-footer__financing">
                Monthly financing available.
              </p>
            ) : null}
          </div>

          {columns.map((column) => (
            <div className="zf-footer__col" key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.href}`}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {showFooterBlock ? (
            <div className="zf-footer__news">
              {FEATURES.newsletter ? (
                <>
                  <h3>Newsletter</h3>
                  <p>Sign up for store news and updates.</p>
                  <NewsletterForm />
                </>
              ) : (
                <h3>Contact</h3>
              )}
              {settings.phone && phoneHref ? (
                <p className="zf-footer__contact">
                  <a href={phoneHref}>{settings.phone}</a>
                </p>
              ) : null}
              {settings.email ? (
                <p className="zf-footer__contact">
                  <a href={`mailto:${settings.email}`}>{settings.email}</a>
                </p>
              ) : null}
            </div>
          ) : null}
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
