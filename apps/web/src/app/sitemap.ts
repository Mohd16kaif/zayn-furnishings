import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { isPagePublished, type PublishedPageKey } from "@/config/pages";
import { IS_STAGING } from "@/lib/appEnv";
import { SITE_URL } from "@/lib/pageMetadata";
import { getCategories, getProducts, getSettings } from "@/lib/publicApi";

const PRODUCT_PAGE_SIZE = 48;
const MAX_PRODUCT_PAGES = 1000;

type StaticPage = {
  path: string;
  key?: PublishedPageKey;
};

const STATIC_PAGES: StaticPage[] = [
  { path: "" },
  { path: "/about", key: "about" },
  { path: "/contact", key: "contact" },
  { path: "/faq", key: "faq" },
  { path: "/delivery", key: "delivery" },
  { path: "/returns", key: "returns" },
  { path: "/privacy", key: "privacy" },
  { path: "/terms", key: "terms" },
  { path: "/accessibility", key: "accessibility" },
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

async function productSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (slugs.length < total && page <= MAX_PRODUCT_PAGES) {
    const { data } = await getProducts({
      page,
      pageSize: PRODUCT_PAGE_SIZE,
      sort: "newest",
    });

    total = data.total;

    if (data.items.length === 0) {
      break;
    }

    for (const item of data.items) {
      slugs.push(item.slug);
    }

    if (data.items.length < PRODUCT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const { data: settings } = await getSettings();

  if (IS_STAGING || !settings.store_open) {
    return [];
  }

  const [{ data: categories }, products, activeProducts, saleProducts] =
    await Promise.all([
      getCategories(),
      productSlugs(),
      getProducts({ page: 1, pageSize: 1 }),
      getProducts({ page: 1, pageSize: 1, onSale: true }),
    ]);

  const now = new Date();
  const conditionalPaths: string[] = [];

  if (activeProducts.data.total > 0) {
    conditionalPaths.push("/new");
  }

  if (saleProducts.data.total > 0) {
    conditionalPaths.push("/sale");
  }

  const productUrls = Array.from(new Set(products)).map((slug) => ({
    url: `${SITE_URL}/p/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
  }));

  return [
    ...STATIC_PAGES.filter(
      (page) => !page.key || isPagePublished(page.key),
    ).map((page) => ({
      url: `${SITE_URL}${page.path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...conditionalPaths.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...categorySlugs(categories).map((slug) => ({
      url: `${SITE_URL}/c/${slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...productUrls,
  ];
}
