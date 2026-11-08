import {
  and,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import {
  categories,
  orderItems,
  products,
  stockMovements,
} from "../db/schema";
import {
  HttpError,
  assertProductSlugAvailable,
  assertSkuAvailable,
  sendError,
  sendValidationError,
  serializeProduct,
  slugify,
  toNumericString,
  uniqueProductSlug,
  uniqueSku,
  writeAudit,
  type Executor,
} from "../lib/adminCatalog";
import { requireAdmin } from "../middleware/requireAdmin";

const statusSchema = z.enum(["draft", "active", "archived"]);
const numericField = z.number().finite().nonnegative().nullable().optional();

const productCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  slug: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  price_cents: z.number().int("Enter a valid price.").nonnegative(),
  sale_price_cents: z
    .number()
    .int("Enter a valid sale price.")
    .nonnegative()
    .nullable()
    .optional(),
  sku: z.string().trim().min(1, "SKU is required.").max(100),
  stock_qty: z.number().int().nonnegative().optional(),
  low_stock_threshold: z.number().int().nonnegative().optional(),
  width_in: numericField,
  depth_in: numericField,
  height_in: numericField,
  weight_lb: numericField,
  material: z.string().trim().max(200).nullable().optional(),
  color: z.string().trim().max(200).nullable().optional(),
  status: statusSchema.optional(),
  category_id: z.string().uuid("Choose a valid category.").nullable().optional(),
  is_featured: z.boolean().optional(),
  seo_title: z.string().trim().max(200).nullable().optional(),
  seo_description: z.string().trim().max(500).nullable().optional(),
});

const productUpdateSchema = productCreateSchema
  .omit({ stock_qty: true })
  .partial();

const stockSchema = z.object({
  mode: z.enum(["add", "remove", "set"]),
  quantity: z.number().int("Enter a whole number.").nonnegative(),
  reason: z.enum(["restock", "manual_adjust", "correction", "return"]),
  note: z.string().trim().max(1000).nullable().optional(),
});

const productQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category_id: z.string().uuid().optional(),
  status: statusSchema.optional(),
  low_stock: z
    .preprocess((value) => {
      if (value === "true" || value === true) {
        return true;
      }
      if (value === "false" || value === false) {
        return false;
      }
      return undefined;
    }, z.boolean().optional()),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

async function getCategoryName(
  executor: Executor,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (!categoryId) {
    return null;
  }

  const [category] = await executor
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);

  if (!category) {
    throw new HttpError(400, "The selected category was not found.", {
      category_id: "The selected category was not found.",
    });
  }

  return category.name;
}

export function validateSalePrice(
  priceCents: number,
  salePriceCents: number | null | undefined,
): void {
  if (
    salePriceCents !== null &&
    salePriceCents !== undefined &&
    salePriceCents >= priceCents
  ) {
    throw new HttpError(
      400,
      "Sale price must be less than the regular price.",
      { sale_price_cents: "Sale price must be less than the regular price." },
    );
  }
}

export type StockMode = "add" | "remove" | "set";

export function computeStockQuantity(
  currentQty: number,
  mode: StockMode,
  quantity: number,
): number {
  let nextQty: number;

  if (mode === "add") {
    nextQty = currentQty + quantity;
  } else if (mode === "remove") {
    nextQty = currentQty - quantity;
  } else {
    nextQty = quantity;
  }

  if (nextQty < 0) {
    throw new HttpError(
      400,
      `Stock cannot go below zero. There ${
        currentQty === 1 ? "is" : "are"
      } only ${currentQty} available.`,
      { quantity: `You can remove at most ${currentQty}.` },
    );
  }

  return nextQty;
}

export const adminProductsRouter = Router();

adminProductsRouter.use(requireAdmin);

adminProductsRouter.get(
  "/products",
  async (req: Request, res: Response) => {
    const parsed = productQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const { search, category_id, status, low_stock, page, page_size } =
      parsed.data;

    try {
      const conditions: SQL[] = [];

      if (search) {
        const term = `%${search}%`;
        const searchCondition = or(
          ilike(products.name, term),
          ilike(products.sku, term),
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      if (category_id) {
        conditions.push(eq(products.categoryId, category_id));
      }

      if (status) {
        conditions.push(eq(products.status, status));
      }

      if (low_stock) {
        conditions.push(
          sql`${products.stockQty} <= ${products.lowStockThreshold}`,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ value: count() })
        .from(products)
        .where(where);

      const rows = await db
        .select({ product: products, categoryName: categories.name })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(desc(products.createdAt))
        .limit(page_size)
        .offset((page - 1) * page_size);

      res.json({
        items: rows.map((row) =>
          serializeProduct(row.product, row.categoryName),
        ),
        total: Number(totalRow?.value ?? 0),
        page,
        page_size,
      });
    } catch (error) {
      sendError(res, error, "Failed to load products");
    }
  },
);

adminProductsRouter.get(
  "/products/:id",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid product id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const [row] = await db
        .select({ product: products, categoryName: categories.name })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(eq(products.id, id.data))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Product not found." });
        return;
      }

      res.json(serializeProduct(row.product, row.categoryName));
    } catch (error) {
      sendError(res, error, "Failed to load product");
    }
  },
);

adminProductsRouter.post(
  "/products",
  async (req: Request, res: Response) => {
    const parsed = productCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        validateSalePrice(
          parsed.data.price_cents,
          parsed.data.sale_price_cents,
        );

        const categoryName = await getCategoryName(
          tx,
          parsed.data.category_id,
        );

        const slug = parsed.data.slug?.trim()
          ? slugify(parsed.data.slug)
          : await uniqueProductSlug(tx, parsed.data.name);

        if (parsed.data.slug?.trim()) {
          await assertProductSlugAvailable(tx, slug);
        }

        await assertSkuAvailable(tx, parsed.data.sku);

        const stockQty = parsed.data.stock_qty ?? 0;

        const [product] = await tx
          .insert(products)
          .values({
            name: parsed.data.name,
            slug,
            description: parsed.data.description ?? null,
            priceCents: parsed.data.price_cents,
            salePriceCents: parsed.data.sale_price_cents ?? null,
            sku: parsed.data.sku,
            stockQty,
            lowStockThreshold: parsed.data.low_stock_threshold ?? 2,
            widthIn: toNumericString(parsed.data.width_in),
            depthIn: toNumericString(parsed.data.depth_in),
            heightIn: toNumericString(parsed.data.height_in),
            weightLb: toNumericString(parsed.data.weight_lb),
            material: parsed.data.material ?? null,
            color: parsed.data.color ?? null,
            status: parsed.data.status ?? "draft",
            categoryId: parsed.data.category_id ?? null,
            isFeatured: parsed.data.is_featured ?? false,
            seoTitle: parsed.data.seo_title ?? null,
            seoDescription: parsed.data.seo_description ?? null,
          })
          .returning();

        if (stockQty > 0) {
          await tx.insert(stockMovements).values({
            productId: product.id,
            change: stockQty,
            reason: "manual_adjust",
            adminUserId: req.admin!.id,
            note: "Initial stock",
          });
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "product.create",
          entity: "product",
          entityId: product.id,
          details: {
            fields: [
              "name",
              "slug",
              "description",
              "price_cents",
              "sale_price_cents",
              "sku",
              "stock_qty",
              "low_stock_threshold",
              "width_in",
              "depth_in",
              "height_in",
              "weight_lb",
              "material",
              "color",
              "status",
              "category_id",
              "is_featured",
              "seo_title",
              "seo_description",
            ],
          },
        });

        return { product, categoryName };
      });

      res
        .status(201)
        .json(serializeProduct(result.product, result.categoryName));
    } catch (error) {
      sendError(res, error, "Failed to create product");
    }
  },
);

adminProductsRouter.patch(
  "/products/:id",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid product id is required." });
      return;
    }

    const parsed = productUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(products)
          .where(eq(products.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Product not found.");
        }

        const data = parsed.data;

        const nextPrice = data.price_cents ?? existing.priceCents;
        const nextSalePrice =
          data.sale_price_cents !== undefined
            ? data.sale_price_cents
            : existing.salePriceCents;

        validateSalePrice(nextPrice, nextSalePrice);

        const categoryName =
          data.category_id !== undefined
            ? await getCategoryName(tx, data.category_id)
            : await getCategoryName(tx, existing.categoryId);

        if (data.slug !== undefined) {
          const nextSlug = slugify(data.slug);
          if (nextSlug !== existing.slug) {
            await assertProductSlugAvailable(tx, nextSlug, existing.id);
          }
        }

        if (data.sku !== undefined && data.sku !== existing.sku) {
          await assertSkuAvailable(tx, data.sku, existing.id);
        }

        const updates: Record<string, unknown> = {};
        const changed: string[] = [];

        const direct: Array<[keyof typeof data, string]> = [
          ["name", "name"],
          ["description", "description"],
          ["price_cents", "priceCents"],
          ["sale_price_cents", "salePriceCents"],
          ["sku", "sku"],
          ["low_stock_threshold", "lowStockThreshold"],
          ["material", "material"],
          ["color", "color"],
          ["status", "status"],
          ["category_id", "categoryId"],
          ["is_featured", "isFeatured"],
          ["seo_title", "seoTitle"],
          ["seo_description", "seoDescription"],
        ];

        for (const [snake, camel] of direct) {
          const value = data[snake];
          if (
            value !== undefined &&
            value !== (existing as Record<string, unknown>)[camel]
          ) {
            updates[camel] = value;
            changed.push(snake);
          }
        }

        if (data.slug !== undefined) {
          const nextSlug = slugify(data.slug);
          if (nextSlug !== existing.slug) {
            updates.slug = nextSlug;
            changed.push("slug");
          }
        }

        const numeric: Array<[keyof typeof data, string, string]> = [
          ["width_in", "widthIn", "width_in"],
          ["depth_in", "depthIn", "depth_in"],
          ["height_in", "heightIn", "height_in"],
          ["weight_lb", "weightLb", "weight_lb"],
        ];

        for (const [snake, camel, field] of numeric) {
          const value = data[snake];
          if (value !== undefined) {
            const next = toNumericString(value as number | null);
            const current = (existing as Record<string, unknown>)[camel];
            if (next !== current) {
              updates[camel] = next;
              changed.push(field);
            }
          }
        }

        if (changed.length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(products)
            .set(updates as Partial<typeof products.$inferInsert>)
            .where(eq(products.id, existing.id));
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "product.update",
          entity: "product",
          entityId: existing.id,
          details: { fields: changed },
        });

        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, existing.id))
          .limit(1);

        return { product, categoryName };
      });

      res.json(serializeProduct(result.product, result.categoryName));
    } catch (error) {
      sendError(res, error, "Failed to update product");
    }
  },
);

adminProductsRouter.post(
  "/products/:id/stock",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid product id is required." });
      return;
    }

    const parsed = stockSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const newQuantity = await db.transaction(async (tx) => {
        const [product] = await tx
          .select({
            id: products.id,
            stockQty: products.stockQty,
          })
          .from(products)
          .where(eq(products.id, id.data))
          .for("update");

        if (!product) {
          throw new HttpError(404, "Product not found.");
        }

        const nextQty = computeStockQuantity(
          product.stockQty,
          parsed.data.mode,
          parsed.data.quantity,
        );

        await tx
          .update(products)
          .set({ stockQty: nextQty, updatedAt: new Date() })
          .where(eq(products.id, product.id));

        await tx.insert(stockMovements).values({
          productId: product.id,
          change: nextQty - product.stockQty,
          reason: parsed.data.reason,
          adminUserId: req.admin!.id,
          note: parsed.data.note ?? null,
        });

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "product.stock",
          entity: "product",
          entityId: product.id,
          details: {
            fields: ["stock_qty"],
            mode: parsed.data.mode,
            reason: parsed.data.reason,
            change: nextQty - product.stockQty,
          },
        });

        return nextQty;
      });

      res.json({ stock_qty: newQuantity });
    } catch (error) {
      sendError(res, error, "Failed to update stock");
    }
  },
);

adminProductsRouter.post(
  "/products/:id/duplicate",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid product id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(products)
          .where(eq(products.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Product not found.");
        }

        const name = `Copy of ${existing.name}`;
        const slug = await uniqueProductSlug(tx, `copy-of-${existing.slug}`);
        const sku = await uniqueSku(tx, `${existing.sku ?? "SKU"}-COPY`);

        const [copy] = await tx
          .insert(products)
          .values({
            name,
            slug,
            description: existing.description,
            priceCents: existing.priceCents,
            salePriceCents: existing.salePriceCents,
            sku,
            stockQty: 0,
            lowStockThreshold: existing.lowStockThreshold,
            widthIn: existing.widthIn,
            depthIn: existing.depthIn,
            heightIn: existing.heightIn,
            weightLb: existing.weightLb,
            material: existing.material,
            color: existing.color,
            status: "draft",
            categoryId: existing.categoryId,
            isFeatured: existing.isFeatured,
            seoTitle: existing.seoTitle,
            seoDescription: existing.seoDescription,
          })
          .returning();

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "product.duplicate",
          entity: "product",
          entityId: copy.id,
          details: { fields: [], source_id: existing.id },
        });

        const categoryName = await getCategoryName(tx, copy.categoryId);

        return { product: copy, categoryName };
      });

      res
        .status(201)
        .json(serializeProduct(result.product, result.categoryName));
    } catch (error) {
      sendError(res, error, "Failed to duplicate product");
    }
  },
);

adminProductsRouter.delete(
  "/products/:id",
  async (req: Request, res: Response) => {
    if (req.admin?.role !== "owner") {
      res.status(403).json({ error: "Only the owner can delete products." });
      return;
    }

    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid product id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(products)
          .where(eq(products.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Product not found.");
        }

        const [usedInOrders] = await tx
          .select({ value: count() })
          .from(orderItems)
          .where(eq(orderItems.productId, existing.id));

        if (Number(usedInOrders?.value ?? 0) > 0) {
          throw new HttpError(
            409,
            "This product appears in past orders. Archive it instead of deleting it.",
          );
        }

        await tx.delete(products).where(eq(products.id, existing.id));

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "product.delete",
          entity: "product",
          entityId: existing.id,
          details: { fields: [] },
        });
      });

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete product");
    }
  },
);
