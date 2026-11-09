import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AnnouncementBar,
} from "@/components/design/announcement-bar";
import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { SiteFooter } from "@/components/design/site-footer";
import { SiteHeader } from "@/components/design/site-header";
import { DesignPreview } from "./design-preview";
import type { PreviewImages } from "./preview-data";

export const instant = false;

function resolveImage(relativePath: string) {
  try {
    const absolutePath = join(process.cwd(), "public", relativePath);
    return existsSync(absolutePath) ? `/${relativePath}` : null;
  } catch {
    return null;
  }
}

const images: PreviewImages = {
  hero: resolveImage("images/home/hero-1.jpg"),
  rooms: [
    resolveImage("images/home/room-living.jpg"),
    resolveImage("images/home/room-bedroom.jpg"),
    resolveImage("images/home/room-dining.jpg"),
    resolveImage("images/home/room-office.jpg"),
    null,
    null,
  ],
  craft: resolveImage("images/home/craft.jpg"),
  promo: resolveImage("images/home/hero-2.jpg"),
};

export default function DesignPreviewPage() {
  return (
    <div id="top">
      <SmoothScroll />
      <ScrollProgress />
      <a className="zf-skip" href="#main">
        Skip to content
      </a>

      <AnnouncementBar />
      <SiteHeader />

      <main id="main">
        <DesignPreview images={images} />
      </main>

      <SiteFooter />
    </div>
  );
}
