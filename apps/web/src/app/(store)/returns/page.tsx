import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/storefront/placeholder-page";
import { placeholderPageMetadata } from "@/lib/pageMetadata";

export const instant = false;

export const metadata: Metadata = placeholderPageMetadata(
  "returns",
  "Returns",
  "Returns information for Zayn Furnishings is being prepared and will be published when available.",
);

export default function ReturnsPage() {
  return <PlaceholderPage title="Returns" />;
}
