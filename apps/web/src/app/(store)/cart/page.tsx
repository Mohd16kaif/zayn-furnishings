import type { Metadata } from "next";
import { getCategories } from "@/lib/publicApi";
import { CartPageClient } from "./cart-page-client";

export const instant = false;

export const metadata: Metadata = {
  title: "Cart",
  description: "Review your cart and estimated delivery.",
  robots: { index: false, follow: true },
};

export default async function CartPage() {
  const { data: categories } = await getCategories();

  return <CartPageClient categories={categories} />;
}
