import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/storefront/placeholder-page";
import { placeholderPageMetadata } from "@/lib/pageMetadata";

export const instant = false;

export const metadata: Metadata = placeholderPageMetadata(
  "faq",
  "FAQ",
  "Frequently asked questions about Zayn Furnishings are being prepared and will be published when available.",
);

export default function FaqPage() {
  return <PlaceholderPage title="FAQ" />;
}
