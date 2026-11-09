"use client";

import { Craft } from "@/components/storefront/craft";
import { Faq } from "@/components/storefront/faq";
import { FeaturedCarousel } from "@/components/storefront/featured-carousel";
import { Hero } from "@/components/storefront/hero";
import { Promo } from "@/components/storefront/promo";
import { Rooms } from "@/components/storefront/rooms";
import { Signature } from "@/components/storefront/signature";
import { Testimonials } from "@/components/design/testimonials";
import { TrustStrip } from "@/components/storefront/trust-strip";
import type { PreviewImages } from "./preview-data";

// Page sections only — the shared storefront shell (skip link, announcement,
// header, footer, smooth scroll, progress line) is provided by the page.
export function DesignPreview({ images }: { images: PreviewImages }) {
  return (
    <>
      <Hero image={images.hero} />
      <TrustStrip />
      <Rooms images={images.rooms} />
      <Signature />
      <FeaturedCarousel />
      <Craft image={images.craft} />
      <Promo image={images.promo} />
      <Testimonials />
      <Faq />
    </>
  );
}
