import type { MetadataRoute } from "next";
import { getCategories } from "@/lib/publicApi";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const staticPaths = [
  "",
  "/about",
  "/contact",
  "/faq",
  "/delivery",
  "/returns",
  "/privacy",
  "/terms",
  "/accessibility",
  "/cart",
  "/account",
  "/wishlist",
];

function categorySlugs(
  categories: Awaited<ReturnType<typeof getCategories>>["data"],
): string[] {
  const slugs: string[] = [];

  const walk = (nodes: typeof categories) => {
    for (const node of nodes) {
      slugs.push(node.slug);
      walk(node.children);
    }
  };

  walk(categories);

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: categories } = await getCategories();

  return [
    ...staticPaths.map((path) => ({
      url: `${baseUrl}${path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
    })),
    ...categorySlugs(categories).map((slug) => ({
      url: `${baseUrl}/c/${slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
    })),
  ];
}
