import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

let supabaseProtocol: "http" | "https" = "https";
let supabaseHostname: string | null = null;

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    supabaseProtocol = parsed.protocol === "http:" ? "http" : "https";
    supabaseHostname = parsed.hostname;
  } catch {
    supabaseHostname = null;
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@zayn/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: supabaseProtocol,
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/product-images/**",
          },
        ]
      : [],
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
