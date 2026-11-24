import path from "node:path";
import type { NextConfig } from "next";
import { buildMediaImageSettings } from "./scripts/media-image-config.mjs";

const mediaImages = buildMediaImageSettings(process.env);
const standaloneOutput = process.env.NEXT_OUTPUT === "standalone";

for (const warning of mediaImages.warnings) {
  console.warn(`[next.config] ${warning}`);
}

const nextConfig: NextConfig = {
  ...(standaloneOutput
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: path.resolve(__dirname, "../.."),
      }
    : {}),
  transpilePackages: ["@zayn/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: mediaImages.remotePatterns,
    localPatterns: mediaImages.localPatterns,
    ...(mediaImages.dangerouslyAllowLocalIP
      ? { dangerouslyAllowLocalIP: true }
      : {}),
  },
  rewrites: async () => [
    {
      source: "/media/:path*",
      destination: mediaImages.rewriteDestination,
    },
  ],
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
