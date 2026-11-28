import type { Metadata } from "next";
import { getSettings } from "@/lib/publicApi";
import { placeholderPageMetadata } from "@/lib/pageMetadata";

export const instant = false;

export const metadata: Metadata = placeholderPageMetadata(
  "contact",
  "Contact",
  "Contact Zayn Furnishings by phone or email when store contact details are configured.",
);

export default async function ContactPage() {
  const { data: settings } = await getSettings();
  const phoneHref = settings.phone
    ? `tel:${settings.phone.replace(/[^\d+]/g, "")}`
    : null;

  return (
    <section className="zf-section zf-page">
      <div className="zf-container">
        <h1>Contact</h1>
        {settings.phone || settings.email ? (
          <div className="zf-page__contact">
            {settings.phone && phoneHref ? (
              <p>
                <a href={phoneHref}>{settings.phone}</a>
              </p>
            ) : null}
            {settings.email ? (
              <p>
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              </p>
            ) : null}
          </div>
        ) : (
          <p>Contact details are not available yet.</p>
        )}
      </div>
    </section>
  );
}
