import type { Metadata } from "next";
import { CheckoutClient } from "@/components/storefront/checkout-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
