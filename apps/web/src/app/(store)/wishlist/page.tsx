import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FEATURES } from "@/config/features";
import { PlaceholderPage } from "@/components/storefront/placeholder-page";
import { buildPageMetadata } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Wishlist",
  description:
    "Save favorite Zayn Furnishings pieces to a wishlist for later.",
  path: "/wishlist",
  noindex: true,
});

export default function WishlistPage() {
  if (!FEATURES.wishlist) {
    notFound();
  }

  return <PlaceholderPage title="Wishlist" />;
}
