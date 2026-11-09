import { Cormorant_Garamond, Jost } from "next/font/google";

/** Theme fonts shared by the storefront and the design preview layouts. */
export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
});

export const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-jost",
  display: "swap",
});

export const themeFontClass = `${cormorant.variable} ${jost.variable}`;

/** Inline no-flash script: applies the stored dark theme before paint. */
export const themeSeedScript = `(function(){try{var t=window.localStorage.getItem("zf-theme")==="dark"?"dark":"light";var r=document.documentElement;if(t==="dark"){r.setAttribute("data-zf-theme","dark");}else{r.removeAttribute("data-zf-theme");}}catch(e){}})();`;
