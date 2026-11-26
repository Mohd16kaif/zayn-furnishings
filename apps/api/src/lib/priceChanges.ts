import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  BULK_PRICE_MAX_CENTS,
  BULK_PRICE_MAX_PRODUCTS,
  BULK_PRICE_PERCENT_MAX,
  BULK_PRICE_PERCENT_MIN,
  computeBulkPriceChange,
  describeBulkPriceChange,
  type BulkPriceChangeParams,
  type BulkPriceProductStatus,
  type BulkPriceChangeResult,
  type BulkPriceChangeRow,
  type BulkPriceProduct,
} from "@zayn/shared";
import {
  adminUsers,
  categories,
  priceChangeBatches,
  priceChangeItems,
  products,
} from "../db/schema";
import {
  HttpError,
  writeAudit,
  type Database,
  type Executor,
} from "./adminCatalog";
import { verifyPriceChangePreview } from "./priceChangeToken";

const hasAtMostTwoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z
    .object({
      type: z.literal("category"),
      category_id: z.string().uuid("Choose a valid category."),
      include_children: z.boolean().default(true),
    })
    .strict(),
]);

const baseParams = {
  scope: scopeSchema,
  statuses: z
    .array(z.enum(["active", "draft", "archived"]))
    .min(1, "Choose at least one product status.")
    .max(3)
    .default(["active", "draft"]),
  apply_to: z.enum(["regular", "sale", "both"]),
  rounding: z.enum(["none", "nearest_dollar", "end_99", "end_00_up"]),
};

const percentParams = z
  .object({
    ...baseParams,
    mode: z.enum(["percent_increase", "percent_decrease"]),
    value: z
      .number()
      .finite("Enter a valid percentage.")
      .min(BULK_PRICE_PERCENT_MIN, "Enter at least 0.01%.")
      .max(BULK_PRICE_PERCENT_MAX, "Enter 90% or less.")
      .refine(hasAtMostTwoDecimals, "Use at most 2 decimal places."),
  })
  .strict();

const amountParams = z
  .object({
    ...baseParams,
    mode: z.enum(["amount_increase", "amount_decrease"]),
    value: z
      .number()
      .int("Enter a whole number of cents.")
      .min(1, "Enter at least $0.01.")
      .max(BULK_PRICE_MAX_CENTS, "Enter $1,000,000.00 or less."),
  })
  .strict();

export const priceChangeParamsSchema = z.discriminatedUnion("mode", [
  percentParams,
  amountParams,
]);

export type PriceChangeParamsInput = z.infer<
  typeof priceChangeParamsSchema
>;

export type NormalizedPriceChangeParams = {
  input: PriceChangeParamsInput;
  categoryIds: string[] | null;
  categoryName: string | null;
};

function toSharedParams(
  input: PriceChangeParamsInput,
  normalized: NormalizedPriceChangeParams,
): BulkPriceChangeParams {
  return {
    scope:
      input.scope.type === "all"
        ? { type: "all" }
        : {
            type: "category",
            categoryId: input.scope.category_id,
            includeChildren: input.scope.include_children,
            categoryIds: normalized.categoryIds ?? [],
            categoryName: normalized.categoryName,
          },
    productStatus: input.statuses,
    mode: input.mode,
    value: input.value,
    applyTo: input.apply_to,
    rounding: input.rounding,
  };
}

function toStoredParams(
  input: PriceChangeParamsInput,
  normalized: NormalizedPriceChangeParams,
): BulkPriceChangeParams {
  return {
    scope:
      input.scope.type === "all"
        ? { type: "all" }
        : {
            type: "category",
            categoryId: input.scope.category_id,
            includeChildren: input.scope.include_children,
            categoryName: normalized.categoryName,
          },
    productStatus: input.statuses,
    mode: input.mode,
    value: input.value,
    applyTo: input.apply_to,
    rounding: input.rounding,
  };
}

export async function normalizePriceChangeParams(
  executor: Executor,
  input: PriceChangeParamsInput,
): Promise<NormalizedPriceChangeParams> {
  if (input.scope.type === "all") {
    return { input, categoryIds: null, categoryName: null };
  }

  const [category] = await executor
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, input.scope.category_id))
    .limit(1);

  if (!category) {
    throw new HttpError(400, "The selected category was not found.", {
      scope: "The selected category was not found.",
    });
  }

  const categoryIds = [category.id];

  if (input.scope.include_children) {
    const children = await executor
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, category.id));

    categoryIds.push(...children.map((child) => child.id));
  }

  return {
    input,
    categoryIds,
    categoryName: category.name,
  };
}

async function loadProducts(
  executor: Executor,
  input: PriceChangeParamsInput,
  normalized: NormalizedPriceChangeParams,
  lock: boolean,
): Promise<BulkPriceProduct[]> {
  const conditions: SQL[] = [
    inArray(products.status, input.statuses),
  ];

  if (normalized.categoryIds) {
    conditions.push(inArray(products.categoryId, normalized.categoryIds));
  }

  const query = executor
    .select({
      id: products.id,
      name: products.name,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      status: products.status,
      categoryId: products.categoryId,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.id))
    .limit(BULK_PRICE_MAX_PRODUCTS + 1);

  const rows = lock ? await query.for("update") : await query;

  if (rows.length > BULK_PRICE_MAX_PRODUCTS) {
    throw new HttpError(
      400,
      `This change would affect more than ${BULK_PRICE_MAX_PRODUCTS} products. Narrow the category or status and try again.`,
    );
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    salePriceCents: row.salePriceCents,
    status: row.status as BulkPriceProductStatus,
    categoryId: row.categoryId,
  }));
}

export async function previewPriceChange(
  executor: Executor,
  input: PriceChangeParamsInput,
): Promise<
  BulkPriceChangeResult & {
    normalized: NormalizedPriceChangeParams;
  }
> {
  const normalized = await normalizePriceChangeParams(executor, input);
  const productRows = await loadProducts(
    executor,
    input,
    normalized,
    false,
  );
  const result = computeBulkPriceChange(
    productRows,
    toSharedParams(input, normalized),
  );

  return { ...result, normalized };
}

export type ApplyPriceChangeResult = {
  batch: typeof priceChangeBatches.$inferSelect;
  counts: BulkPriceChangeResult["counts"];
  totals: BulkPriceChangeResult["totals"];
  params: BulkPriceChangeParams;
};

export async function applyPriceChange(
  database: Database,
  options: {
    adminId: string;
    params: PriceChangeParamsInput;
    previewToken: string;
    secret: string;
    now?: Date;
  },
): Promise<ApplyPriceChangeResult> {
  return database.transaction(async (tx) => {
    const normalized = await normalizePriceChangeParams(tx, options.params);
    const productRows = await loadProducts(
      tx,
      options.params,
      normalized,
      true,
    );
    const result = computeBulkPriceChange(
      productRows,
      toSharedParams(options.params, normalized),
    );
    const okRows = result.rows.filter((row) => row.status === "ok");
    const verification = verifyPriceChangePreview({
      token: options.previewToken,
      params: options.params,
      okRows,
      secret: options.secret,
      now: options.now,
    });

    if (!verification.ok) {
      throw new HttpError(
        409,
        verification.reason === "expired"
          ? "This preview has expired. Preview again and confirm the new numbers."
          : "Prices changed since you previewed. Preview again and confirm the new numbers.",
      );
    }

    if (okRows.length === 0) {
      throw new HttpError(
        400,
        "No prices would change. Adjust the filters or the amount and preview again.",
      );
    }

    for (const row of okRows) {
      await tx
        .update(products)
        .set({
          priceCents: row.newPrice,
          salePriceCents: row.newSale,
        })
        .where(eq(products.id, row.productId));
    }

    const storedParams = toStoredParams(options.params, normalized);
    const [batch] = await tx
      .insert(priceChangeBatches)
      .values({
        adminUserId: options.adminId,
        params: storedParams,
        itemCount: okRows.length,
      })
      .returning();

    await tx.insert(priceChangeItems).values(
      okRows.map((row) => ({
        batchId: batch.id,
        productId: row.productId,
        oldPriceCents: row.oldPrice,
        oldSalePriceCents: row.oldSale,
        newPriceCents: row.newPrice,
        newSalePriceCents: row.newSale,
      })),
    );

    await writeAudit(tx, {
      adminUserId: options.adminId,
      action: "price_change.apply",
      entity: "price_change_batch",
      entityId: batch.id,
      details: {
        params: storedParams,
        counts: result.counts,
        item_count: okRows.length,
      },
    });

    return {
      batch,
      counts: result.counts,
      totals: result.totals,
      params: storedParams,
    };
  });
}

export type UndoPriceChangeResult = {
  restored_count: number;
  skipped_count: number;
  skipped: Array<{
    product_id: string;
    product_name: string | null;
    reason: string;
  }>;
};

export async function undoPriceChangeBatch(
  database: Database,
  options: { adminId: string; batchId: string },
): Promise<UndoPriceChangeResult> {
  return database.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(priceChangeBatches)
      .where(eq(priceChangeBatches.id, options.batchId))
      .limit(1);

    if (!batch) {
      throw new HttpError(404, "Price change not found.");
    }

    if (batch.undoneAt) {
      throw new HttpError(
        409,
        "This price change has already been undone.",
      );
    }

    const items = await tx
      .select()
      .from(priceChangeItems)
      .where(eq(priceChangeItems.batchId, options.batchId));

    const productIds = [
      ...new Set(items.map((item) => item.productId)),
    ];
    const productRows =
      productIds.length > 0
        ? await tx
            .select()
            .from(products)
            .where(inArray(products.id, productIds))
            .orderBy(asc(products.id))
            .for("update")
        : [];
    const productsById = new Map(
      productRows.map((product) => [product.id, product]),
    );
    const skipped: UndoPriceChangeResult["skipped"] = [];
    let restored = 0;

    for (const item of items) {
      const product = productsById.get(item.productId);

      if (!product) {
        skipped.push({
          product_id: item.productId,
          product_name: null,
          reason: "The product no longer exists.",
        });
        continue;
      }

      if (
        product.priceCents !== item.newPriceCents ||
        product.salePriceCents !== item.newSalePriceCents
      ) {
        skipped.push({
          product_id: item.productId,
          product_name: product.name,
          reason: "Changed since the price change.",
        });
        continue;
      }

      await tx
        .update(products)
        .set({
          priceCents: item.oldPriceCents,
          salePriceCents: item.oldSalePriceCents,
        })
        .where(eq(products.id, item.productId));
      restored += 1;
    }

    const [undone] = await tx
      .update(priceChangeBatches)
      .set({
        undoneAt: new Date(),
        undoneByAdminUserId: options.adminId,
      })
      .where(
        and(
          eq(priceChangeBatches.id, options.batchId),
          isNull(priceChangeBatches.undoneAt),
        ),
      )
      .returning();

    if (!undone) {
      throw new HttpError(
        409,
        "This price change has already been undone.",
      );
    }

    await writeAudit(tx, {
      adminUserId: options.adminId,
      action: "price_change.undo",
      entity: "price_change_batch",
      entityId: options.batchId,
      details: {
        restored_count: restored,
        skipped_count: skipped.length,
        params: batch.params,
      },
    });

    return {
      restored_count: restored,
      skipped_count: skipped.length,
      skipped,
    };
  });
}

type BatchListRow = {
  batch: typeof priceChangeBatches.$inferSelect;
  adminEmail: string | null;
  adminName: string | null;
  undoneEmail: string | null;
  undoneName: string | null;
};

function serializeBatch(row: BatchListRow) {
  return {
    id: row.batch.id,
    created_at: row.batch.createdAt,
    item_count: row.batch.itemCount,
    undone_at: row.batch.undoneAt,
    admin: {
      id: row.batch.adminUserId,
      email: row.adminEmail,
      name: row.adminName,
    },
    undone_by: row.batch.undoneByAdminUserId
      ? {
          id: row.batch.undoneByAdminUserId,
          email: row.undoneEmail,
          name: row.undoneName,
        }
      : null,
    params: row.batch.params,
    summary: describeBulkPriceChange(
      row.batch.params as BulkPriceChangeParams,
    ),
  };
}

export async function listPriceChangeBatches(executor: Executor) {
  const undoneBy = alias(adminUsers, "price_change_undone_by");
  const rows = await executor
    .select({
      batch: priceChangeBatches,
      adminEmail: adminUsers.email,
      adminName: adminUsers.name,
      undoneEmail: undoneBy.email,
      undoneName: undoneBy.name,
    })
    .from(priceChangeBatches)
    .leftJoin(
      adminUsers,
      eq(priceChangeBatches.adminUserId, adminUsers.id),
    )
    .leftJoin(
      undoneBy,
      eq(priceChangeBatches.undoneByAdminUserId, undoneBy.id),
    )
    .orderBy(desc(priceChangeBatches.createdAt))
    .limit(20);

  return rows.map(serializeBatch);
}

export async function getPriceChangeBatch(
  executor: Executor,
  batchId: string,
) {
  const undoneBy = alias(adminUsers, "price_change_undone_by");
  const [row] = await executor
    .select({
      batch: priceChangeBatches,
      adminEmail: adminUsers.email,
      adminName: adminUsers.name,
      undoneEmail: undoneBy.email,
      undoneName: undoneBy.name,
    })
    .from(priceChangeBatches)
    .leftJoin(
      adminUsers,
      eq(priceChangeBatches.adminUserId, adminUsers.id),
    )
    .leftJoin(
      undoneBy,
      eq(priceChangeBatches.undoneByAdminUserId, undoneBy.id),
    )
    .where(eq(priceChangeBatches.id, batchId))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "Price change not found.");
  }

  const items = await executor
    .select({
      item: priceChangeItems,
      productName: products.name,
    })
    .from(priceChangeItems)
    .leftJoin(
      products,
      eq(priceChangeItems.productId, products.id),
    )
    .where(eq(priceChangeItems.batchId, batchId))
    .orderBy(asc(priceChangeItems.productId));

  return {
    batch: serializeBatch(row),
    items: items.map((entry) => ({
      id: entry.item.id,
      product_id: entry.item.productId,
      product_name: entry.productName,
      old_price_cents: entry.item.oldPriceCents,
      old_sale_price_cents: entry.item.oldSalePriceCents,
      new_price_cents: entry.item.newPriceCents,
      new_sale_price_cents: entry.item.newSalePriceCents,
    })),
  };
}

export function serializePriceChangeRow(row: BulkPriceChangeRow) {
  return {
    product_id: row.productId,
    name: row.name,
    category_id: row.categoryId,
    product_status: row.productStatus,
    old_price_cents: row.oldPrice,
    old_sale_price_cents: row.oldSale,
    new_price_cents: row.newPrice,
    new_sale_price_cents: row.newSale,
    status: row.status,
    reason: row.reason,
  };
}
