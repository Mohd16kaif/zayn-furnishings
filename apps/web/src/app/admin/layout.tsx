import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StagingBanner } from "@/components/design/site-mode-banners";
import { IS_STAGING } from "@/lib/appEnv";

export const metadata: Metadata = {
  title: "Admin | Zayn Furnishings",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {IS_STAGING ? <StagingBanner /> : null}
      {children}
    </>
  );
}
