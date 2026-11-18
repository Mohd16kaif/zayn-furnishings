import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { IS_STAGING } from "@/lib/appEnv";
import { getSettings, PUBLIC_SETTINGS_TAG } from "@/lib/publicApi";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_SETTINGS_TAG);

  const { data: settings } = await getSettings();
  const privateSite = IS_STAGING || !settings.store_open;

  return {
    title: {
      default: "Zayn Furnishings",
      template: "%s | Zayn Furnishings",
    },
    description:
      "Quiet luxury for the American home. Furniture made to be lived in.",
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
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
