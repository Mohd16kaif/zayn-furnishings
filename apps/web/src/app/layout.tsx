import type { Metadata, Viewport } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { IS_STAGING } from "@/lib/appEnv";
import {
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/pageMetadata";
import { getSettings, PUBLIC_SETTINGS_TAG } from "@/lib/publicApi";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7F2" },
    { media: "(prefers-color-scheme: dark)", color: "#2A1D14" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_SETTINGS_TAG);

  const { data: settings } = await getSettings();
  const privateSite = IS_STAGING || !settings.store_open;
  const comingSoon = !settings.store_open;
  const title = comingSoon
    ? `${settings.store_name} | Coming soon`
    : SITE_NAME;
  const description = comingSoon
    ? `${settings.store_name} is preparing to open. Please check back soon.`
    : null;

  return {
    metadataBase: SITE_URL,
    title: comingSoon
      ? { absolute: title }
      : {
          default: SITE_NAME,
          template: TITLE_TEMPLATE,
        },
    ...(description
      ? {
          description,
          alternates: { canonical: "/" },
          openGraph: {
            title,
            description,
            siteName: SITE_NAME,
            type: "website" as const,
          },
          twitter: {
            card: "summary" as const,
            title,
            description,
          },
        }
      : {}),
    ...(privateSite
      ? {
          robots: {
            index: false,
            follow: false,
            googleBot: {
              index: false,
              follow: false,
            },
          },
        }
      : {}),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-US" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
