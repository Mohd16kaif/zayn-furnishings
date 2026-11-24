import type { NextConfig } from "next";
import { buildMediaImageSettings } from "./scripts/media-image-config.mjs";

const mediaImages = buildMediaImageSettings(process.env);

for (const warning of mediaImages.warnings) {
  console.warn(`[next.config] ${warning}`);
}

const nextConfig: NextConfig = {
  transpilePackages: ["@zayn/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: mediaImages.remotePatterns,
    ...(mediaImages.dangerouslyAllowLocalIP
      ? { dangerouslyAllowLocalIP: true }
      : {}),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
