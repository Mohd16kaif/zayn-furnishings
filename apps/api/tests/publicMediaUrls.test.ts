import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Router } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  productRows: [] as Row[],
  imageRows: [] as Row[],
  categoryRows: [] as Row[],
  contentRows: [] as Row[],
  categoryCounts: [] as Row[],
}));

vi.mock("../src/db/client", async () => {
  const { categories, contentBlocks, productImages, products } =
    await import("../src/db/schema");

  function rowsFor(table: unknown, projection?: Row): Row[] {
    if (table === products) {
      if (projection) {
        if ("minPrice" in projection || "maxPrice" in projection) {
          return [{ minPrice: null, maxPrice: null }];
        }

        if ("material" in projection || "color" in projection) {
          return [];
        }

        if ("categoryId" in projection && "value" in projection) {
          return state.categoryCounts;
        }

        if ("value" in projection) {
          return [{ value: state.productRows.length }];
        }
      }

      return state.productRows;
    }

    if (table === productImages) {
      return state.imageRows;
    }

    if (table === categories) {
      return state.categoryRows;
    }

    if (table === contentBlocks) {
      return state.contentRows;
    }

    return [];
  }

  function selectBuilder(projection?: Row) {
    let table: unknown = null;
    const chain = {
      from(nextTable: unknown) {
        table = nextTable;
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where() {
        return chain;
      },
      groupBy() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      offset() {
        return chain;
      },
      then(
        resolve: (value: Row[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(rowsFor(table, projection)).then(
          resolve,
          reject,
        );
      },
    };

    return chain;
  }

  return {
    db: {
      select: (projection?: Row) => selectBuilder(projection),
      selectDistinct: (projection?: Row) => selectBuilder(projection),
    },
    connection: null,
  };
});

vi.stubEnv("MEDIA_DRIVER", "local");
vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "https://media.example.com/");

let publicRouter: Router;

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const CONTENT_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_IMAGE_PATH = `products/${PRODUCT_ID}/${IMAGE_ID}.webp`;
const CATEGORY_IMAGE_PATH = `categories/${CATEGORY_ID}/${IMAGE_ID}.webp`;
const CONTENT_IMAGE_PATH = `content/${CONTENT_ID}/${IMAGE_ID}.webp`;
const MEDIA_BASE = "https://media.example.com";
const OLD_SUPABASE_BASE =
  "https://old-project.supabase.co/storage/v1/object/public/product-images";

function productRow(overrides: Row = {}): Row {
  return {
    product: {
      id: PRODUCT_ID,
      name: "Oak Chair",
      slug: "oak-chair",
      description: null,
      priceCents: 10000,
      salePriceCents: null,
      sku: "OAK-1",
      stockQty: 3,
      lowStockThreshold: 2,
      widthIn: null,
      depthIn: null,
      heightIn: null,
      weightLb: null,
      material: null,
      color: null,
      status: "active",
      categoryId: null,
      isFeatured: false,
      seoTitle: null,
      seoDescription: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    },
    categoryName: null,
    categorySlug: null,
    categoryParentId: null,
  };
}

function expectNoStoragePath(value: unknown): void {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain("storage_path");
  expect(serialized).not.toContain("storagePath");
}

let server: Server | null = null;
let baseUrl: string;

async function startServer(router: Router): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/public", router);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  publicRouter = (await import("../src/routes/public")).publicRouter;
});

beforeEach(async () => {
  state.productRows.length = 0;
  state.imageRows.length = 0;
  state.categoryRows.length = 0;
  state.contentRows.length = 0;
  state.categoryCounts.length = 0;

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  }

  await startServer(publicRouter);
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  }

  vi.unstubAllEnvs();
});

describe("public responses resolve local media URLs", () => {
  it("uses the media URL for product detail images", async () => {
    state.productRows.push(productRow());
    state.imageRows.push({
      id: IMAGE_ID,
      url: `${OLD_SUPABASE_BASE}/${PRODUCT_IMAGE_PATH}`,
      storagePath: PRODUCT_IMAGE_PATH,
      altText: "Oak chair",
      sortOrder: 0,
    });

    const response = await fetch(
      `${baseUrl}/api/public/products/oak-chair`,
    );
    const body = (await response.json()) as {
      images: Array<{ url: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.images[0]?.url).toBe(
      `${MEDIA_BASE}/media/${PRODUCT_IMAGE_PATH}`,
    );
    expectNoStoragePath(body);
  });

  it("uses the media URL for product list primary images", async () => {
    state.productRows.push(productRow());
    state.imageRows.push({
      productId: PRODUCT_ID,
      url: `${OLD_SUPABASE_BASE}/${PRODUCT_IMAGE_PATH}`,
      storagePath: PRODUCT_IMAGE_PATH,
    });

    const response = await fetch(
      `${baseUrl}/api/public/products?page_size=1`,
    );
    const body = (await response.json()) as {
      items: Array<{ primary_image_url: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.items[0]?.primary_image_url).toBe(
      `${MEDIA_BASE}/media/${PRODUCT_IMAGE_PATH}`,
    );
    expectNoStoragePath(body);
  });

  it("uses the media URL for search suggestion images", async () => {
    state.productRows.push(productRow());
    state.imageRows.push({
      productId: PRODUCT_ID,
      url: `${OLD_SUPABASE_BASE}/${PRODUCT_IMAGE_PATH}`,
      storagePath: PRODUCT_IMAGE_PATH,
    });
    state.categoryRows.push({ name: "Living Room", slug: "living-room" });

    const response = await fetch(
      `${baseUrl}/api/public/search/suggest?q=oak`,
    );
    const body = (await response.json()) as {
      products: Array<{ primary_image_url: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.products[0]?.primary_image_url).toBe(
      `${MEDIA_BASE}/media/${PRODUCT_IMAGE_PATH}`,
    );
    expectNoStoragePath(body);
  });

  it("uses the media URL for category images", async () => {
    state.categoryRows.push({
      id: CATEGORY_ID,
      name: "Living Room",
      slug: "living-room",
      parentId: null,
      imageUrl: `${OLD_SUPABASE_BASE}/${CATEGORY_IMAGE_PATH}`,
      imageStoragePath: CATEGORY_IMAGE_PATH,
      description: null,
      sortOrder: 0,
      isActive: true,
      seoTitle: null,
      seoDescription: null,
    });

    const response = await fetch(`${baseUrl}/api/public/categories`);
    const body = (await response.json()) as Array<{
      image_url: string | null;
    }>;

    expect(response.status).toBe(200);
    expect(body[0]?.image_url).toBe(
      `${MEDIA_BASE}/media/${CATEGORY_IMAGE_PATH}`,
    );
    expectNoStoragePath(body);
  });

  it("uses the media URL for home content images", async () => {
    state.contentRows.push({
      id: CONTENT_ID,
      type: "hero",
      title: "Winter collection",
      subtitle: null,
      body: null,
      imageUrl: `${OLD_SUPABASE_BASE}/${CONTENT_IMAGE_PATH}`,
      storagePath: CONTENT_IMAGE_PATH,
      buttonText: null,
      linkUrl: null,
      sortOrder: 0,
    });

    const response = await fetch(`${baseUrl}/api/public/content/home`);
    const body = (await response.json()) as Record<
      string,
      Array<{ image_url: string | null }>
    >;

    expect(response.status).toBe(200);
    expect(body.hero?.[0]?.image_url).toBe(
      `${MEDIA_BASE}/media/${CONTENT_IMAGE_PATH}`,
    );
    expectNoStoragePath(body);
  });
});
