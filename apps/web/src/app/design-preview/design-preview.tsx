"use client";

import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { Craft } from "@/components/design/craft";
import { Faq } from "@/components/design/faq";
import { FeaturedCarousel } from "@/components/design/featured-carousel";
import { Footer } from "@/components/design/footer";
import { Hero } from "@/components/design/hero";
import { Navbar } from "@/components/design/navbar";
import { Promo } from "@/components/design/promo";
import { Rooms } from "@/components/design/rooms";
import { Signature } from "@/components/design/signature";
import { Testimonials } from "@/components/design/testimonials";
import { TrustStrip } from "@/components/design/trust-strip";
import type { PreviewImages } from "./preview-data";

export function DesignPreview({ images }: { images: PreviewImages }) {
  return (
    <div id="top">
      <SmoothScroll />
      <ScrollProgress />
      <a className="zf-skip" href="#main">
        Skip to content
      </a>

      <div className="zf-announce">
        Complimentary white-glove delivery on orders over $1,999
      </div>

      <Navbar />

      <main id="main">
        <Hero image={images.hero} />
        <TrustStrip />
        <Rooms images={images.rooms} />
        <Signature />
        <FeaturedCarousel />
        <Craft image={images.craft} />
        <Promo image={images.promo} />
        <Testimonials />
        <Faq />
      </main>

      <Footer />
    </div>
  );
}
