import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  themeFontClass,
  themeSeedScript,
} from "@/components/design/fonts";
import "@/styles/theme.css";
import { ThemeProvider } from "@/components/design/theme-provider";

export const metadata: Metadata = {
  title: "Design Preview | Zayn Furnishings",
  description:
    "A visual design preview of the Zayn Furnishings luxury storefront concept.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function DesignPreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeSeedScript }} />
      <ThemeProvider fontClassName={themeFontClass}>{children}</ThemeProvider>
    </>
  );
}
