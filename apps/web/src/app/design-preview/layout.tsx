import type { Metadata } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import type { ReactNode } from "react";
import "@/styles/theme.css";
import { ThemeProvider } from "@/components/design/theme-provider";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-jost",
  display: "swap",
});

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

const themeSeedScript = `(function(){try{var t=window.localStorage.getItem("zf-theme")==="dark"?"dark":"light";var r=document.documentElement;if(t==="dark"){r.setAttribute("data-zf-theme","dark");}else{r.removeAttribute("data-zf-theme");}}catch(e){}})();`;

export default function DesignPreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeSeedScript }} />
      <ThemeProvider fontClassName={`${cormorant.variable} ${jost.variable}`}>
        {children}
      </ThemeProvider>
    </>
  );
}
