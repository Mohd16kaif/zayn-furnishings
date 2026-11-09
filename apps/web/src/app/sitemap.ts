import type { MetadataRoute } from "next";
import { getCategories, getProducts } from "@/lib/publicApi";

const PRODUCT_PAGE_SIZE = 48;
const MAX_PRODUCT_PAGES = 1000;

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
    url: `${baseUrl}/p/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
  }));

  return [
    ...staticPaths.map((path) => ({
      url: `${baseUrl}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...conditionalPaths.map((path) => ({
      url: `${baseUrl}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...categorySlugs(categories).map((slug) => ({
      url: `${baseUrl}/c/${slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
    })),
    ...productUrls,
  ];
}
