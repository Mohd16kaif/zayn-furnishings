import type { Metadata } from "next";
import { StoreNotFound } from "@/components/storefront/store-not-found";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFoundRoute() {
  return <StoreNotFound />;
}
