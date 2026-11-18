import type { ReactNode } from "react";
import { AnnouncementBar } from "@/components/design/announcement-bar";
import { CartProvider } from "@/components/design/cart-provider";
import { CustomerProvider } from "@/components/design/customer-provider";
import { SiteFooter } from "@/components/design/site-footer";
import { SiteHeader } from "@/components/design/site-header";
import { themeFontClass, themeSeedScript } from "@/components/design/fonts";
import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { ThemeProvider } from "@/components/design/theme-provider";
import {
  StagingBanner,
  StorePreviewBanner,
} from "@/components/design/site-mode-banners";
import { ComingSoon } from "@/components/storefront/coming-soon";
import { hasAdminPreviewSession } from "@/lib/adminPreview";
import { IS_STAGING } from "@/lib/appEnv";
import { getCurrentCustomer } from "@/lib/authServer";
import { getSettings } from "@/lib/publicApi";
import "@/styles/theme.css";

// The storefront shell fetches live catalog data, so navigation into this
// segment is allowed to block (opts out of instant-navigation validation).
export const instant = false;

export default async function StoreLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [customer, settingsResult] = await Promise.all([
    getCurrentCustomer(),
    getSettings(),
  ]);
  const settings = settingsResult.data;
  const closed = !settings.store_open;
  const preview = closed ? await hasAdminPreviewSession() : false;

  if (closed && !preview) {
    return (
      <div id="top">
        {IS_STAGING ? <StagingBanner /> : null}
        <ComingSoon
          storeName={settings.store_name}
          email={settings.email}
          phone={settings.phone}
        />
      </div>
    );
  }

  return (
    <div id="top">
      <script dangerouslySetInnerHTML={{ __html: themeSeedScript }} />
      <CartProvider>
        <CustomerProvider initialCustomer={customer}>
          <ThemeProvider fontClassName={themeFontClass}>
            <SmoothScroll />
            <ScrollProgress />
            <a className="zf-skip" href="#main">
              Skip to content
            </a>

            {IS_STAGING ? <StagingBanner /> : null}
            {closed && preview ? <StorePreviewBanner /> : null}
            <AnnouncementBar />
            <SiteHeader />

            <main id="main">{children}</main>

            <SiteFooter />
          </ThemeProvider>
        </CustomerProvider>
      </CartProvider>
    </div>
  );
}
