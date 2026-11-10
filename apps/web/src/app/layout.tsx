import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Zayn Furnishings",
    template: "%s | Zayn Furnishings",
  },
  description:
    "Quiet luxury for the American home. Furniture made to be lived in.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
