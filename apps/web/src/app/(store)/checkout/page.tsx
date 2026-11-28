import type { Metadata } from "next";
import { CheckoutClient } from "@/components/storefront/checkout-client";
import { buildPageMetadata } from "@/lib/pageMetadata";

export const instant = false;

export const metadata: Metadata = buildPageMetadata({
  title: "Checkout",
  description:
    "Complete your Zayn Furnishings order and review delivery details.",
  path: "/checkout",
  noindex: true,
});

export default function CheckoutPage() {
  return <CheckoutClient />;
}
