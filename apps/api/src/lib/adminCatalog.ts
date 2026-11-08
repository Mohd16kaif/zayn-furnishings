import { and, eq, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import {
  auditLog,
  categories,
  products,
  type Product,
  type ProductImage,
} from "../db/schema";

export type Database = PostgresJsDatabase<Record<string, never>>;
export type Transaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type Executor = Database | Transaction;

export class HttpError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fields = fields;
  }
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }

  return fields;
}

export function sendValidationError(
  res: import("express").Response,
  error: z.ZodError,
): void {
  res.status(400).json({
    error: "Please check the highlighted fields.",
    fields: fieldErrors(error),
  });
}

export function sendError(
  res: import("express").Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    });
    return;
  }

  if (isUniqueViolation(error)) {
    const field = uniqueViolationField(error);
    const label = field === "sku" ? "SKU" : "URL slug";

    res.status(409).json({
      error: `That ${label} is already in use. Please choose another one.`,
      ...(field ? { fields: { [field]: `${label} is already in use.` } } : {}),
    });
    return;
  }

  console.error(
    `${context}:`,
    error instanceof Error ? error.message : error,
  );
  res.status(500).json({ error: "Server error" });
}

type DatabaseError = {
  code?: string;
  constraint_name?: string;
  message?: string;
  cause?: unknown;
};

function unwrapDatabaseError(error: unknown): DatabaseError {
  let current = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      break;
    }

    const candidate = current as DatabaseError;

    if (candidate.code) {
      return candidate;
    }

    current = candidate.cause;
  }

  return typeof error === "object" && error !== null
    ? (error as DatabaseError)
    : {};
}

export function isUniqueViolation(error: unknown): boolean {
  return unwrapDatabaseError(error).code === "23505";
}

export function uniqueViolationField(error: unknown): "slug" | "sku" | null {
  if (!isUniqueViolation(error)) {
    return null;
  }

  const databaseError = unwrapDatabaseError(error);
  const constraint = databaseError.constraint_name ?? "";
  const message = databaseError.message ?? "";

  if (constraint.includes("sku") || message.includes("sku")) {
    return "sku";
  }

  if (constraint.includes("slug") || message.includes("slug")) {
    return "slug";
  }

  return null;
}

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "item";
}

async function categorySlugExists(
  executor: Executor,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(
      excludeId
        ? and(eq(categories.slug, slug), ne(categories.id, excludeId))
        : eq(categories.slug, slug),
    )
    .limit(1);

  return Boolean(row);
}

async function productSlugExists(
  executor: Executor,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: products.id })
    .from(products)
    .where(
      excludeId
        ? and(eq(products.slug, slug), ne(products.id, excludeId))
        : eq(products.slug, slug),
    )
    .limit(1);

  return Boolean(row);
}

async function skuExists(
  executor: Executor,
  sku: string,
  excludeId?: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: products.id })
    .from(products)
    .where(
      excludeId
        ? and(eq(products.sku, sku), ne(products.id, excludeId))
        : eq(products.sku, sku),
    )
    .limit(1);

  return Boolean(row);
}

async function makeUnique(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  let candidate = base;
  let suffix = 1;

  while (await exists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export function uniqueCategorySlug(
  executor: Executor,
  name: string,
): Promise<string> {
  return makeUnique(slugify(name), (candidate) =>
    categorySlugExists(executor, candidate),
  );
}

export function uniqueProductSlug(
  executor: Executor,
  nameOrSlug: string,
): Promise<string> {
  return makeUnique(slugify(nameOrSlug), (candidate) =>
    productSlugExists(executor, candidate),
  );
}

export function uniqueSku(
  executor: Executor,
  base: string,
): Promise<string> {
  return makeUnique(slugifySku(base), (candidate) =>
    skuExists(executor, candidate),
  );
}

export async function assertCategorySlugAvailable(
  executor: Executor,
  slug: string,
  excludeId?: string,
): Promise<void> {
  if (await categorySlugExists(executor, slug, excludeId)) {
    throw new HttpError(409, "That URL slug is already in use.", {
      slug: "URL slug is already in use.",
    });
  }
}

export async function assertProductSlugAvailable(
  executor: Executor,
  slug: string,
  excludeId?: string,
): Promise<void> {
  if (await productSlugExists(executor, slug, excludeId)) {
    throw new HttpError(409, "That URL slug is already in use.", {
      slug: "URL slug is already in use.",
    });
  }
}

export async function assertSkuAvailable(
  executor: Executor,
  sku: string,
  excludeId?: string,
): Promise<void> {
  if (await skuExists(executor, sku, excludeId)) {
    throw new HttpError(409, "That SKU is already in use.", {
      sku: "SKU is already in use.",
    });
  }
}

function slugifySku(input: string): string {
  return (
    input
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "SKU"
  );
}

export async function writeAudit(
  executor: Executor,
  input: {
    adminUserId: string;
    action: string;
    entity: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await executor.insert(auditLog).values({
    adminUserId: input.adminUserId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    details: input.details ?? {},
  });
}

export type SerializedProductImage = {
  id: string;
  product_id: string;
  url: string;
  storage_path: string | null;
  alt_text: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

export type SerializedProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  sale_price_cents: number | null;
  sku: string | null;
  stock_qty: number;
  low_stock_threshold: number;
  width_in: number | null;
  depth_in: number | null;
  height_in: number | null;
  weight_lb: number | null;
  material: string | null;
  color: string | null;
  status: Product["status"];
  category_id: string | null;
  category_name: string | null;
  is_featured: boolean;
  seo_title: string | null;
  seo_description: string | null;
  images: SerializedProductImage[];
  primary_image_url: string | null;
  created_at: Date;
  updated_at: Date;
};

export function serializeProductImage(
  image: ProductImage,
): SerializedProductImage {
  return {
    id: image.id,
    product_id: image.productId,
    url: image.url,
    storage_path: image.storagePath,
    alt_text: image.altText,
    sort_order: image.sortOrder,
    created_at: image.createdAt,
    updated_at: image.updatedAt,
  };
}

function toNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function serializeProduct(
  product: Product,
  categoryName: string | null = null,
  options: {
    images?: SerializedProductImage[];
    primaryImageUrl?: string | null;
  } = {},
): SerializedProduct {
  const images = options.images ?? [];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price_cents: product.priceCents,
    sale_price_cents: product.salePriceCents,
    sku: product.sku,
    stock_qty: product.stockQty,
    low_stock_threshold: product.lowStockThreshold,
    width_in: toNumber(product.widthIn),
    depth_in: toNumber(product.depthIn),
    height_in: toNumber(product.heightIn),
    weight_lb: toNumber(product.weightLb),
    material: product.material,
    color: product.color,
    status: product.status,
    category_id: product.categoryId,
    category_name: categoryName,
    is_featured: product.isFeatured,
    seo_title: product.seoTitle,
    seo_description: product.seoDescription,
    images,
    primary_image_url:
      options.primaryImageUrl ?? images[0]?.url ?? null,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toFixed(2);
}
