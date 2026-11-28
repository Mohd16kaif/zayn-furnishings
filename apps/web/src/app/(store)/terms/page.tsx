import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/storefront/placeholder-page";
import { placeholderPageMetadata } from "@/lib/pageMetadata";

export const instant = false;

export const metadata: Metadata = placeholderPageMetadata(
  "terms",
  "Terms",
  "Terms information for Zayn Furnishings is being prepared and will be published when available.",
);

export default function TermsPage() {
  return <PlaceholderPage title="Terms" />;
}
