import type { Metadata } from "next";
import { getCategories } from "@/lib/publicApi";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { CartPageClient } from "./cart-page-client";

export const instant = false;

export const metadata: Metadata = buildPageMetadata({
  title: "Cart",
  description:
    "Review items in your Zayn Furnishings cart and continue to checkout.",
  path: "/cart",
  noindex: true,
});

export default async function CartPage() {
  const { data: categories } = await getCategories();

  return <CartPageClient categories={categories} />;
}
