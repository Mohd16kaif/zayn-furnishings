import { count, isNotNull } from "drizzle-orm";
import { connection, db } from "../db/client";
import { categories, products } from "../db/schema";
import { HttpError } from "../lib/adminCatalog";
import {
  computeStockQuantity,
  validateSalePrice,
} from "../routes/adminProducts";

function unwrap(error: unknown): {
  code?: string;
  constraint_name?: string;
  message?: string;
} {
  let current = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      break;
    }

    const candidate = current as {
      code?: string;
      constraint_name?: string;
      message?: string;
      cause?: unknown;
    };

    if (candidate.code) {
      return candidate;
    }

    current = candidate.cause;
  }

  return {};
}

class Rollback extends Error {
  rejected: boolean;

  constructor(rejected: boolean) {
    super("rollback");
    this.rejected = rejected;
  }
}

function rejectsHttpError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof HttpError;
  }
}

async function constraintTest(
  fn: (tx: Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0]) => Promise<void>,
  isExpected: (error: unknown) => boolean,
): Promise<boolean> {
  if (!db) {
    throw new Error("DATABASE_URL is required.");
  }

  try {
    await db.transaction(async (tx) => {
      let rejected = false;

      try {
        await fn(tx);
      } catch (error) {
        rejected = isExpected(error);
        if (!rejected) {
          console.error("Unexpected error:", error);
        }
      }

      throw new Rollback(rejected);
    });
  } catch (error) {
    if (error instanceof Rollback) {
      return error.rejected;
    }

    throw error;
  }

  return false;
}

async function main() {
  if (!db) {
    throw new Error("DATABASE_URL is required.");
  }

  const [categoryCount] = await db
    .select({ value: count() })
    .from(categories);
  const [productCount] = await db.select({ value: count() }).from(products);
  const [existing] = await db
    .select({ sku: products.sku })
    .from(products)
    .where(isNotNull(products.sku))
    .limit(1);
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .limit(1);
  const stamp = Date.now();

  const saleDbConstraintRejected = await constraintTest(
    async (tx) => {
      await tx.insert(products).values({
        name: "verify sale",
        slug: `verify-sale-${stamp}`,
        priceCents: 1000,
        salePriceCents: 1000,
        sku: `VERIFY-SALE-${stamp}`,
        status: "draft",
        categoryId: category?.id ?? null,
      });
    },
    (error) =>
      String(unwrap(error).constraint_name ?? "").includes("sale_price"),
  );

  const duplicateSkuRejected = await constraintTest(
    async (tx) => {
      if (!existing?.sku) {
        throw new Error("No existing SKU to reuse.");
      }

      await tx.insert(products).values({
        name: "verify sku",
        slug: `verify-sku-${stamp}`,
        priceCents: 1000,
        sku: existing.sku,
        status: "draft",
      });
    },
    (error) => unwrap(error).code === "23505",
  );

  const negativeStockDbConstraintRejected = await constraintTest(
    async (tx) => {
      await tx.insert(products).values({
        name: "verify stock",
        slug: `verify-stock-${stamp}`,
        priceCents: 1000,
        sku: `VERIFY-STOCK-${stamp}`,
        stockQty: -1,
        status: "draft",
      });
    },
    (error) =>
      String(unwrap(error).constraint_name ?? "").includes(
        "stock_qty_non_negative",
      ),
  );

  console.log(
    JSON.stringify(
      {
        categories: Number(categoryCount?.value ?? 0),
        products: Number(productCount?.value ?? 0),
        salePriceValidationRejected: rejectsHttpError(() =>
          validateSalePrice(1000, 1000),
        ),
        salePriceDbConstraintRejected: saleDbConstraintRejected,
        duplicateSkuRejected,
        negativeStockValidationRejected: rejectsHttpError(() =>
          computeStockQuantity(1, "remove", 2),
        ),
        negativeStockDbConstraintRejected,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Verification failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
