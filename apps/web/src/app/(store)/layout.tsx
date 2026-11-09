import type { ReactNode } from "react";
import {
  AnnouncementBar,
} from "@/components/design/announcement-bar";
import { CartProvider } from "@/components/design/cart-provider";
import { SiteFooter } from "@/components/design/site-footer";
import { SiteHeader } from "@/components/design/site-header";
import { themeFontClass, themeSeedScript } from "@/components/design/fonts";
import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { ThemeProvider } from "@/components/design/theme-provider";

// The storefront shell fetches live catalog data, so navigation into this
// segment is allowed to block (opts out of instant-navigation validation).
export const instant = false;

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <div id="top">
      <script dangerouslySetInnerHTML={{ __html: themeSeedScript }} />
      <CartProvider>
        <ThemeProvider fontClassName={themeFontClass}>
          <SmoothScroll />
          <ScrollProgress />
          <a className="zf-skip" href="#main">
            Skip to content
          </a>

          <AnnouncementBar />
          <SiteHeader />

          <main id="main">{children}</main>

          <SiteFooter />
        </ThemeProvider>
      </CartProvider>
    </div>
  );
}
