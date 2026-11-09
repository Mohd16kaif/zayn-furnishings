"use client";

import { Craft } from "@/components/design/craft";
import { Faq } from "@/components/design/faq";
import { FeaturedCarousel } from "@/components/design/featured-carousel";
import { Hero } from "@/components/design/hero";
import { Promo } from "@/components/design/promo";
import { Rooms } from "@/components/design/rooms";
import { Signature } from "@/components/design/signature";
import { Testimonials } from "@/components/design/testimonials";
import { TrustStrip } from "@/components/design/trust-strip";
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
