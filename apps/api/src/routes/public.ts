import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { computeDelivery, type PublicDeliveryCheck } from "@zayn/shared";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  categories,
  contentBlocks,
  deliveryZones,
  productImages,
  products,
  type Product,
} from "../db/schema";
import { sendError, sendValidationError } from "../lib/adminCatalog";
import { readStoreSettings } from "../lib/storeSettings";

const PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const PUBLIC_RATE_LIMIT = 120;
const STOREFRONT_RATE_LIMIT = 300;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function storefrontKeyMatches(req: Request): boolean {
  const provided = req.get("x-storefront-key");
  const expected = env.STOREFRONT_API_KEY;

  if (!provided || !expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function trustedVisitorIp(req: Request): string | null {
  if (!storefrontKeyMatches(req)) {
    return null;
  }

  const visitorIp = req.get("x-visitor-ip")?.trim();

  return visitorIp && isIP(visitorIp) ? visitorIp : null;
}

const publicRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: (req: Request) =>
    storefrontKeyMatches(req)
      ? STOREFRONT_RATE_LIMIT
      : PUBLIC_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const visitorIp = trustedVisitorIp(req);

    if (visitorIp) {
      return `storefront:${ipKeyGenerator(visitorIp)}`;
    }

    return ipKeyGenerator(req.ip ?? "");
  },
  message: { error: "Too many requests. Please try again in a minute." },
});

function cacheGet(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
  next();
}

function requireDatabase(res: Response): boolean {
  if (!db) {
    res.status(500).json({ error: "Database is not configured" });
    return false;
  }

  return true;
}

function optionalBooleanQuery() {
  return z.preprocess((value) => {
    if (value === "true" || value === true) {
      return true;
    }
    if (value === "false" || value === false) {
      return false;
    }
    return undefined;
  }, z.boolean().optional());
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function numericValue(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

function centsToDollars(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return Number((Number(value) / 100).toFixed(2));
}

type PublicProductRow = {
  product: Product;
  categoryName: string | null;
  categorySlug: string | null;
};

function serializePublicProductCard(
  row: PublicProductRow,
  primaryImageUrl: string | null,
) {
  return {
    id: row.product.id,
    name: row.product.name,
    slug: row.product.slug,
    price_cents: row.product.priceCents,
    sale_price_cents: row.product.salePriceCents,
    in_stock: row.product.stockQty > 0,
    primary_image_url: primaryImageUrl,
    category_name: row.categoryName,
    category_slug: row.categorySlug,
    material: row.product.material,
    color: row.product.color,
  };
}

async function primaryImagesByProduct(
  productIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (productIds.length === 0 || !db) {
    return result;
  }

  const rows = await db
    .select({
      productId: productImages.productId,
      url: productImages.url,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));

  for (const row of rows) {
    if (!result.has(row.productId)) {
      result.set(row.productId, row.url);
    }
  }

  return result;
}

const productsQuerySchema = z.object({
  category: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  min_price: z.coerce.number().finite().nonnegative().optional(),
  max_price: z.coerce.number().finite().nonnegative().optional(),
  in_stock: optionalBooleanQuery(),
  material: z.string().trim().min(1).max(200).optional(),
  color: z.string().trim().min(1).max(200).optional(),
  on_sale: optionalBooleanQuery(),
  sort: z
    .enum(["newest", "price_asc", "price_desc", "name"])
    .default("newest"),
  featured: optionalBooleanQuery(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(48).default(24),
});

const suggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(40),
});

const deliveryQuerySchema = z.object({
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Enter a 5-digit US ZIP code."),
  subtotal_cents: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional(),
});

const cartValidateSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .max(50),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Enter a 5-digit US ZIP code.")
    .optional(),
});

async function readFreeDeliveryThreshold(): Promise<number | null> {
  const settings = await readStoreSettings(db!);

  return settings.free_delivery_threshold_cents;
}

type DeliveryZoneRow = typeof deliveryZones.$inferSelect;

async function findBestDeliveryZone(
  zip: string,
): Promise<DeliveryZoneRow | null> {
  const zones = await db!
    .select()
    .from(deliveryZones)
    .where(
      and(
        eq(deliveryZones.isActive, true),
        lte(deliveryZones.zipStart, zip),
        gte(deliveryZones.zipEnd, zip),
      ),
    );

  if (zones.length === 0) {
    return null;
  }

  return zones.reduce((current, zone) => {
    const currentSpan =
      Number(current.zipEnd) - Number(current.zipStart);
    const zoneSpan = Number(zone.zipEnd) - Number(zone.zipStart);
    return zoneSpan < currentSpan ? zone : current;
  });
}

function serializeDeliveryZone(zone: DeliveryZoneRow) {
  return {
    name: zone.name,
    zip_start: zone.zipStart,
    zip_end: zone.zipEnd,
    fee_cents: zone.feeCents,
    free_over_cents: zone.freeOverCents,
  };
}

async function computeDeliveryCheck(
  zip: string,
  subtotalCents: number,
): Promise<PublicDeliveryCheck> {
  const zone = await findBestDeliveryZone(zip);

  if (!zone) {
    return {
      available: false,
      zone: null,
      subtotal_cents: subtotalCents,
      fee_cents: null,
      is_free: false,
      free_over_cents: null,
      amount_to_free_cents: null,
    };
  }

  const settingsThresholdCents = await readFreeDeliveryThreshold();
  const computed = computeDelivery({
    zone: {
      feeCents: zone.feeCents,
      freeOverCents: zone.freeOverCents,
    },
    settingsThresholdCents,
    subtotalCents,
  });

  return {
    available: true,
    zone: serializeDeliveryZone(zone),
    subtotal_cents: subtotalCents,
    fee_cents: computed.feeCents,
    is_free: computed.isFree,
    free_over_cents: computed.freeOverCents,
    amount_to_free_cents: computed.amountToFreeCents,
  };
}

async function deliveryForOptionalZip(
  zip: string | undefined,
  subtotalCents: number,
): Promise<PublicDeliveryCheck | null> {
  if (!zip) {
    return null;
  }

  return computeDeliveryCheck(zip, subtotalCents);
}

export const publicRouter = Router();

publicRouter.use(publicRateLimiter);

publicRouter.get(
  "/categories",
  cacheGet,
  async (_req: Request, res: Response) => {
    if (!requireDatabase(res)) {
      return;
    }

    try {
      const rows = await db!
        .select()
        .from(categories)
        .where(eq(categories.isActive, true))
        .orderBy(asc(categories.sortOrder), asc(categories.name));

      const counts = await db!
        .select({ categoryId: products.categoryId, value: count() })
        .from(products)
        .where(eq(products.status, "active"))
        .groupBy(products.categoryId);

      const ownCount = new Map(
        counts.map((row) => [row.categoryId, Number(row.value)]),
      );

      type Node = {
        id: string;
        name: string;
        slug: string;
        image_url: string | null;
        description: string | null;
        sort_order: number;
        product_count: number;
        children: Node[];
      };

      const nodes = new Map<string, Node>();

      for (const category of rows) {
        nodes.set(category.id, {
          id: category.id,
          name: category.name,
          slug: category.slug,
          image_url: category.imageUrl,
          description: category.description,
          sort_order: category.sortOrder,
          product_count: ownCount.get(category.id) ?? 0,
          children: [],
        });
      }

      const roots: Node[] = [];

      for (const category of rows) {
        const node = nodes.get(category.id)!;
        const parent = category.parentId
          ? nodes.get(category.parentId)
          : undefined;

        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }

      function addChildCounts(node: Node): number {
        let total = node.product_count;
        for (const child of node.children) {
          total += addChildCounts(child);
        }
        node.product_count = total;
        return total;
      }

      for (const root of roots) {
        addChildCounts(root);
      }

      type SerializedNode = {
        id: string;
        name: string;
        slug: string;
        image_url: string | null;
        description: string | null;
        product_count: number;
        children: SerializedNode[];
      };

      function serializeNode(node: Node): SerializedNode {
        return {
          id: node.id,
          name: node.name,
          slug: node.slug,
          image_url: node.image_url,
          description: node.description,
          product_count: node.product_count,
          children: node.children.map(serializeNode),
        };
      }

      res.json(roots.map(serializeNode));
    } catch (error) {
      sendError(res, error, "Failed to load public categories");
    }
  },
);

publicRouter.get(
  "/search/suggest",
  async (req: Request, res: Response) => {
    const parsed = suggestQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    try {
      const term = `%${escapeLikePattern(parsed.data.q)}%`;

      const productRows = await db!
        .select({ product: products })
        .from(products)
        .where(
          and(
            eq(products.status, "active"),
            or(
              ilike(products.name, term),
              ilike(products.sku, term),
            ),
          ),
        )
        .orderBy(asc(products.name))
        .limit(6);

      const images = await primaryImagesByProduct(
        productRows.map((row) => row.product.id),
      );

      const categoryRows = await db!
        .select({ name: categories.name, slug: categories.slug })
        .from(categories)
        .where(
          and(
            eq(categories.isActive, true),
            ilike(categories.name, term),
          ),
        )
        .orderBy(asc(categories.name))
        .limit(4);

      res.set("Cache-Control", "public, max-age=30");
      res.json({
        products: productRows.map((row) => ({
          name: row.product.name,
          slug: row.product.slug,
          price_cents: row.product.priceCents,
          sale_price_cents: row.product.salePriceCents,
          primary_image_url: images.get(row.product.id) ?? null,
          in_stock: row.product.stockQty > 0,
        })),
        categories: categoryRows,
      });
    } catch (error) {
      sendError(res, error, "Failed to load search suggestions");
    }
  },
);

publicRouter.get(
  "/products",
  cacheGet,
  async (req: Request, res: Response) => {
    const parsed = productsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    const {
      category,
      q,
      min_price,
      max_price,
      in_stock,
      material,
      color,
      on_sale,
      sort,
      featured,
      page,
      page_size,
    } = parsed.data;

    try {
      const conditions: SQL[] = [eq(products.status, "active")];

      if (category) {
        const [categoryRow] = await db!
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.slug, category),
              eq(categories.isActive, true),
            ),
          )
          .limit(1);

        if (!categoryRow) {
          conditions.push(sql`false`);
        } else {
          const children = await db!
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.parentId, categoryRow.id));

          conditions.push(
            inArray(products.categoryId, [
              categoryRow.id,
              ...children.map((child) => child.id),
            ]),
          );
        }
      }

      if (q) {
        const term = `%${escapeLikePattern(q)}%`;
        const searchCondition = or(
          ilike(products.name, term),
          ilike(products.description, term),
          ilike(products.sku, term),
        );

        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const effectivePrice = sql<number>`coalesce(${products.salePriceCents}, ${products.priceCents})`;

      if (min_price !== undefined) {
        conditions.push(gte(effectivePrice, dollarsToCents(min_price)));
      }

      if (max_price !== undefined) {
        conditions.push(lte(effectivePrice, dollarsToCents(max_price)));
      }

      if (in_stock === true) {
        conditions.push(sql`${products.stockQty} > 0`);
      } else if (in_stock === false) {
        conditions.push(sql`${products.stockQty} = 0`);
      }

      if (material) {
        conditions.push(sql`lower(${products.material}) = lower(${material})`);
      }

      if (color) {
        conditions.push(sql`lower(${products.color}) = lower(${color})`);
      }

      if (on_sale === true) {
        conditions.push(
          and(
            isNotNull(products.salePriceCents),
            lt(products.salePriceCents, products.priceCents),
          )!,
        );
      }

      if (featured !== undefined) {
        conditions.push(eq(products.isFeatured, featured));
      }

      const where = and(...conditions);

      const orderBy = (() => {
        switch (sort) {
          case "price_asc":
            return [asc(effectivePrice), asc(products.name)];
          case "price_desc":
            return [desc(effectivePrice), asc(products.name)];
          case "name":
            return [asc(products.name)];
          default:
            return [desc(products.createdAt)];
        }
      })();

      const [totalRow] = await db!
        .select({ value: count() })
        .from(products)
        .where(where);

      const rows = await db!
        .select({
          product: products,
          categoryName: categories.name,
          categorySlug: categories.slug,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(page_size)
        .offset((page - 1) * page_size);

      const images = await primaryImagesByProduct(
        rows.map((row) => row.product.id),
      );

      const [priceFacet] = await db!
        .select({
          minPrice: min(effectivePrice),
          maxPrice: max(effectivePrice),
        })
        .from(products)
        .where(where);

      const materialRows = await db!
        .selectDistinct({ material: products.material })
        .from(products)
        .where(and(where, isNotNull(products.material)))
        .orderBy(asc(products.material));

      const colorRows = await db!
        .selectDistinct({ color: products.color })
        .from(products)
        .where(and(where, isNotNull(products.color)))
        .orderBy(asc(products.color));

      res.json({
        items: rows.map((row) =>
          serializePublicProductCard(
            row,
            images.get(row.product.id) ?? null,
          ),
        ),
        total: Number(totalRow?.value ?? 0),
        page,
        page_size,
        facets: {
          min_price: centsToDollars(priceFacet?.minPrice ?? null),
          max_price: centsToDollars(priceFacet?.maxPrice ?? null),
          materials: materialRows
            .map((row) => row.material)
            .filter((value): value is string => Boolean(value)),
          colors: colorRows
            .map((row) => row.color)
            .filter((value): value is string => Boolean(value)),
        },
      });
    } catch (error) {
      sendError(res, error, "Failed to load public products");
    }
  },
);

publicRouter.get(
  "/products/:slug",
  cacheGet,
  async (req: Request, res: Response) => {
    const slug = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .safeParse(req.params.slug);

    if (!slug.success) {
      res.status(400).json({ error: "A valid product slug is required." });
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    try {
      const [row] = await db!
        .select({
          product: products,
          categoryName: categories.name,
          categorySlug: categories.slug,
          categoryParentId: categories.parentId,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            eq(products.slug, slug.data),
            eq(products.status, "active"),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Product not found." });
        return;
      }

      const images = await db!
        .select({
          id: productImages.id,
          url: productImages.url,
          altText: productImages.altText,
          sortOrder: productImages.sortOrder,
        })
        .from(productImages)
        .where(eq(productImages.productId, row.product.id))
        .orderBy(
          asc(productImages.sortOrder),
          asc(productImages.createdAt),
        );

      const breadcrumb: Array<{ name: string; slug: string }> = [];

      if (row.categoryName && row.categorySlug) {
        if (row.categoryParentId) {
          const [parent] = await db!
            .select({ name: categories.name, slug: categories.slug })
            .from(categories)
            .where(eq(categories.id, row.categoryParentId))
            .limit(1);

          if (parent) {
            breadcrumb.push(parent);
          }
        }

        breadcrumb.push({
          name: row.categoryName,
          slug: row.categorySlug,
        });
      }

      let related: ReturnType<typeof serializePublicProductCard>[] = [];

      if (row.product.categoryId) {
        const relatedRows = await db!
          .select({
            product: products,
            categoryName: categories.name,
            categorySlug: categories.slug,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              eq(products.categoryId, row.product.categoryId),
              eq(products.status, "active"),
              sql`${products.id} <> ${row.product.id}`,
            ),
          )
          .orderBy(desc(products.createdAt))
          .limit(4);

        const relatedImages = await primaryImagesByProduct(
          relatedRows.map((item) => item.product.id),
        );

        related = relatedRows.map((item) =>
          serializePublicProductCard(
            item,
            relatedImages.get(item.product.id) ?? null,
          ),
        );
      }

      res.json({
        id: row.product.id,
        name: row.product.name,
        slug: row.product.slug,
        description: row.product.description,
        price_cents: row.product.priceCents,
        sale_price_cents: row.product.salePriceCents,
        in_stock: row.product.stockQty > 0,
        material: row.product.material,
        color: row.product.color,
        dimensions: {
          width_in: numericValue(row.product.widthIn),
          depth_in: numericValue(row.product.depthIn),
          height_in: numericValue(row.product.heightIn),
          weight_lb: numericValue(row.product.weightLb),
        },
        images: images.map((image) => ({
          id: image.id,
          url: image.url,
          alt_text: image.altText,
          sort_order: image.sortOrder,
        })),
        category: row.categoryName
          ? { name: row.categoryName, slug: row.categorySlug }
          : null,
        breadcrumb,
        seo_title: row.product.seoTitle,
        seo_description: row.product.seoDescription,
        related_products: related,
      });
    } catch (error) {
      sendError(res, error, "Failed to load public product");
    }
  },
);

publicRouter.post(
  "/cart/validate",
  async (req: Request, res: Response) => {
    const parsed = cartValidateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    res.set("Cache-Control", "no-store");

    try {
      const requested = new Map<string, number>();

      for (const item of parsed.data.items) {
        requested.set(
          item.product_id,
          (requested.get(item.product_id) ?? 0) + item.quantity,
        );
      }

      const productIds = Array.from(requested.keys());

      if (productIds.length === 0) {
        res.json({
          items: [],
          unavailable: [],
          subtotal_cents: 0,
          delivery: await deliveryForOptionalZip(parsed.data.zip, 0),
        });
        return;
      }

      const rows = await db!
        .select()
        .from(products)
        .where(inArray(products.id, productIds));

      const productsById = new Map(rows.map((row) => [row.id, row]));
      const activeRows = rows.filter((row) => row.status === "active");
      const primaryImages = await primaryImagesByProduct(
        activeRows.map((row) => row.id),
      );

      const unavailable: string[] = [];
      const items: Array<{
        id: string;
        slug: string;
        name: string;
        price_cents: number;
        sale_price_cents: number | null;
        effective_price_cents: number;
        primary_image_url: string | null;
        in_stock: boolean;
        available: true;
      }> = [];
      let subtotalCents = 0;

      for (const [productId, quantity] of requested) {
        const product = productsById.get(productId);

        if (!product || product.status !== "active") {
          unavailable.push(productId);
          continue;
        }

        const inStock = product.stockQty > 0;
        const effectivePriceCents =
          product.salePriceCents ?? product.priceCents;

        items.push({
          id: product.id,
          slug: product.slug,
          name: product.name,
          price_cents: product.priceCents,
          sale_price_cents: product.salePriceCents,
          effective_price_cents: effectivePriceCents,
          primary_image_url: primaryImages.get(product.id) ?? null,
          in_stock: inStock,
          available: true,
        });

        if (inStock) {
          subtotalCents += effectivePriceCents * quantity;
        }
      }

      const delivery = await deliveryForOptionalZip(
        parsed.data.zip,
        subtotalCents,
      );

      res.json({
        items,
        unavailable,
        subtotal_cents: subtotalCents,
        delivery,
      });
    } catch (error) {
      sendError(res, error, "Failed to validate cart");
    }
  },
);

publicRouter.get(
  "/content/home",
  cacheGet,
  async (_req: Request, res: Response) => {
    if (!requireDatabase(res)) {
      return;
    }

    try {
      const now = new Date();

      const rows = await db!
        .select()
        .from(contentBlocks)
        .where(
          and(
            eq(contentBlocks.isActive, true),
            or(
              isNull(contentBlocks.startsAt),
              lte(contentBlocks.startsAt, now),
            ),
            or(
              isNull(contentBlocks.endsAt),
              gte(contentBlocks.endsAt, now),
            ),
          ),
        )
        .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.createdAt));

      const grouped: Record<
        string,
        Array<{
          id: string;
          type: string;
          title: string | null;
          subtitle: string | null;
          body: string | null;
          image_url: string | null;
          button_text: string | null;
          link_url: string | null;
          sort_order: number;
        }>
      > = {};

      for (const block of rows) {
        const list = grouped[block.type] ?? (grouped[block.type] = []);
        list.push({
          id: block.id,
          type: block.type,
          title: block.title,
          subtitle: block.subtitle,
          body: block.body,
          image_url: block.imageUrl,
          button_text: block.buttonText,
          link_url: block.linkUrl,
          sort_order: block.sortOrder,
        });
      }

      res.json(grouped);
    } catch (error) {
      sendError(res, error, "Failed to load home content");
    }
  },
);

publicRouter.get(
  "/settings",
  cacheGet,
  async (_req: Request, res: Response) => {
    if (!requireDatabase(res)) {
      return;
    }

    try {
      const settings = await readStoreSettings(db!);
      res.json(settings);
    } catch (error) {
      sendError(res, error, "Failed to load store settings");
    }
  },
);

publicRouter.get(
  "/delivery/check",
  async (req: Request, res: Response) => {
    const parsed = deliveryQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!requireDatabase(res)) {
      return;
    }

    try {
      const subtotalCents = parsed.data.subtotal_cents ?? 0;
      const delivery = await computeDeliveryCheck(
        parsed.data.zip,
        subtotalCents,
      );

      res.json(delivery);
    } catch (error) {
      sendError(res, error, "Failed to check delivery availability");
    }
  },
);
