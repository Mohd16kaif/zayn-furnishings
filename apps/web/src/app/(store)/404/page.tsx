import type { Metadata } from "next";
import { StoreNotFound } from "@/components/storefront/store-not-found";
import { buildPageMetadata } from "@/lib/pageMetadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Page not found",
  description:
    "The page you requested could not be found at Zayn Furnishings.",
  path: "/404",
  noindex: true,
});

export default function NotFoundRoute() {
  return <StoreNotFound />;
}
