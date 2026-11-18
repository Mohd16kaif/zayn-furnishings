import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { IS_STAGING } from "@/lib/appEnv";
import { getSettings } from "@/lib/publicApi";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const { data: settings } = await getSettings();

  if (IS_STAGING || !settings.store_open) {
    return {
      rules: [
        {
          userAgent: "*",
          disallow: "/",
        },
      ],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api", "/api/", "/design-preview"],
      },
    ],
  };
}
