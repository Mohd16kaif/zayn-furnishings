import { randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type { Database } from "../src/db/client";
import {
  adminUsers,
  auditLog,
  categories,
  orderItems,
  orders,
  priceChangeBatches,
  priceChangeItems,
  products,
} from "../src/db/schema";
import type { PriceChangeParamsInput } from "../src/lib/priceChanges";
import {
  applyPriceChange,
  previewPriceChange,
  undoPriceChangeBatch,
} from "../src/lib/priceChanges";
import { signPriceChangePreview } from "../src/lib/priceChangeToken";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL
  ? describe
  : describe.skip;
const SECRET = `test-price-change-db-secret-${"x".repeat(20)}`;

let client: ReturnType<typeof postgres> | null = null;
let database: Database;
const adminIds: string[] = [];
const categoryIds: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];

function uniqueLabel(): string {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

async function createAdmin() {
  const [admin] = await database
    .insert(adminUsers)
    .values({
      email: `price-change-db-${uniqueLabel()}@example.com`,
      role: "owner",
      isActive: true,
    })
    .returning();

  adminIds.push(admin.id);

  return admin;
}

async function createCategory() {
  const [category] = await database
    .insert(categories)
    .values({
      name: `Price change category ${uniqueLabel()}`,
      slug: `price-change-category-${uniqueLabel()}`,
      isActive: true,
    })
    .returning();

  categoryIds.push(category.id);

  return category;
}

async function createProduct(
  categoryId: string,
  priceCents: number,
  salePriceCents: number | null = null,
) {
  const label = uniqueLabel();
  const [product] = await database
    .insert(products)
    .values({
      name: `Price change product ${label}`,
      slug: `price-change-product-${label}`,
      priceCents,
      salePriceCents,
      sku: `PC-${label}`,
      status: "active",
      categoryId,
    })
    .returning();

  productIds.push(product.id);

  return product;
}

async function createOrder(product: typeof products.$inferSelect) {
  const [order] = await database
    .insert(orders)
    .values({
      email: `price-change-order-${uniqueLabel()}@example.com`,
      subtotalCents: product.priceCents,
      totalCents: product.priceCents,
    })
    .returning();

  orderIds.push(order.id);

  await database.insert(orderItems).values({
    orderId: order.id,
    productId: product.id,
    nameSnapshot: product.name,
    skuSnapshot: product.sku,
    unitPriceCents: product.priceCents,
    quantity: 1,
    lineTotalCents: product.priceCents,
  });

  return order;
}

async function scenario() {
  const admin = await createAdmin();
  const category = await createCategory();
  const first = await createProduct(category.id, 1000);
  const second = await createProduct(category.id, 2000);
  const order = await createOrder(first);

  const params: PriceChangeParamsInput = {
    scope: {
      type: "category",
      category_id: category.id,
      include_children: true,
    },
    statuses: ["active"],
    mode: "percent_increase",
    value: 10,
    apply_to: "regular",
    rounding: "none",
  };

  return { admin, category, first, second, order, params };
}

function constraintName(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    const candidate = current as {
      constraint_name?: unknown;
      cause?: unknown;
    };

    if (typeof candidate.constraint_name === "string") {
      return candidate.constraint_name;
    }

    current = candidate.cause;
  }

  return undefined;
}

async function tokenFor(params: PriceChangeParamsInput) {
  const preview = await previewPriceChange(database, params);
  const okRows = preview.rows.filter((row) => row.status === "ok");

  return {
    preview,
    okRows,
    token: signPriceChangePreview({
      params,
      okRows,
      secret: SECRET,
    }),
  };
}

beforeAll(() => {
  if (!TEST_DATABASE_URL) {
    return;
  }

  client = postgres(TEST_DATABASE_URL, {
    max: 5,
    prepare: false,
    onnotice: () => {},
  });
  database = drizzle(client);
});

afterAll(async () => {
  if (!client) {
    return;
  }

  if (adminIds.length > 0) {
    await database
      .delete(priceChangeBatches)
      .where(inArray(priceChangeBatches.adminUserId, adminIds));
  }

  if (orderIds.length > 0) {
    await database.delete(orders).where(inArray(orders.id, orderIds));
  }

  if (productIds.length > 0) {
    await database
      .delete(products)
      .where(inArray(products.id, productIds));
  }

  if (categoryIds.length > 0) {
    await database
      .delete(categories)
      .where(inArray(categories.id, categoryIds));
  }

  if (adminIds.length > 0) {
    await database
      .delete(auditLog)
      .where(inArray(auditLog.adminUserId, adminIds));
    await database
      .delete(adminUsers)
      .where(inArray(adminUsers.id, adminIds));
  }

  await client.end();
});

describeWithDatabase("bulk price change database behavior", () => {
  it(
    "applies in one transaction, writes the batch and items, and leaves orders untouched",
    async () => {
      const { admin, first, second, order, params } = await scenario();
      const { preview, okRows, token } = await tokenFor(params);

      expect(preview.counts).toEqual({
        ok: 2,
        unchanged: 0,
        blocked: 0,
      });
      expect(okRows).toHaveLength(2);

      const result = await applyPriceChange(database, {
        adminId: admin.id,
        params,
        previewToken: token,
        secret: SECRET,
      });

      expect(result.batch.itemCount).toBe(2);

      const updated = await database
        .select()
        .from(products)
        .where(inArray(products.id, [first.id, second.id]))
        .orderBy(asc(products.id));
      const byId = new Map(
        updated.map((product) => [product.id, product]),
      );

      expect(byId.get(first.id)?.priceCents).toBe(1100);
      expect(byId.get(second.id)?.priceCents).toBe(2200);

      const items = await database
        .select()
        .from(priceChangeItems)
        .where(eq(priceChangeItems.batchId, result.batch.id))
        .orderBy(asc(priceChangeItems.productId));

      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            oldPriceCents: 1000,
            newPriceCents: 1100,
          }),
          expect.objectContaining({
            oldPriceCents: 2000,
            newPriceCents: 2200,
          }),
        ]),
      );

      const [audit] = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "price_change.apply"),
            eq(auditLog.entityId, result.batch.id),
          ),
        );

      expect(audit).toBeTruthy();

      const [orderAfter] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, order.id));
      const [orderItemAfter] = await database
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      expect(orderAfter.totalCents).toBe(1000);
      expect(orderAfter.updatedAt.getTime()).toBe(
        order.updatedAt.getTime(),
      );
      expect(orderItemAfter.unitPriceCents).toBe(1000);
      expect(orderItemAfter.lineTotalCents).toBe(1000);
    },
    60_000,
  );

  it(
    "rejects a repeated apply with the same token and writes no second batch",
    async () => {
      const { admin, params } = await scenario();
      const { token } = await tokenFor(params);

      await applyPriceChange(database, {
        adminId: admin.id,
        params,
        previewToken: token,
        secret: SECRET,
      });

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: token,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const [batchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));

      expect(Number(batchCount?.value ?? 0)).toBe(1);
    },
    60_000,
  );

  it(
    "blocks a sale conflict and the database enforces sale price below regular price",
    async () => {
      const admin = await createAdmin();
      const category = await createCategory();
      const product = await createProduct(category.id, 1000, 900);
      const params: PriceChangeParamsInput = {
        scope: {
          type: "category",
          category_id: category.id,
          include_children: true,
        },
        statuses: ["active"],
        mode: "amount_decrease",
        value: 150,
        apply_to: "regular",
        rounding: "none",
      };
      const { preview, token } = await tokenFor(params);
      const row = preview.rows.find(
        (entry) => entry.productId === product.id,
      );

      expect(row?.status).toBe("blocked");
      expect(row?.reason).toContain("no longer be below");

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: token,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 400 });

      const [unchanged] = await database
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(unchanged.priceCents).toBe(1000);
      expect(unchanged.salePriceCents).toBe(900);

      let constraintError: unknown = null;

      try {
        await database
          .update(products)
          .set({ priceCents: 800 })
          .where(eq(products.id, product.id));
      } catch (error) {
        constraintError = error;
      }

      expect(constraintError).not.toBeNull();
      expect(
        `${String(
          (constraintError as { message?: unknown }).message ??
            constraintError,
        )} ${constraintName(constraintError) ?? ""}`,
      ).toContain("products_sale_price_less_than_price");

      const [stillUnchanged] = await database
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(stillUnchanged.priceCents).toBe(1000);
    },
    60_000,
  );

  it(
    "refuses a batch where every matching product would fall below the minimum",
    async () => {
      const admin = await createAdmin();
      const category = await createCategory();
      const first = await createProduct(category.id, 100);
      const second = await createProduct(category.id, 150);
      const params: PriceChangeParamsInput = {
        scope: {
          type: "category",
          category_id: category.id,
          include_children: true,
        },
        statuses: ["active"],
        mode: "amount_decrease",
        value: 200,
        apply_to: "regular",
        rounding: "none",
      };
      const { preview, okRows, token } = await tokenFor(params);

      expect(preview.counts).toEqual({
        ok: 0,
        unchanged: 0,
        blocked: 2,
      });
      expect(okRows).toHaveLength(0);
      expect(
        preview.rows.every(
          (row) =>
            row.status === "blocked" &&
            row.reason?.includes("below $1.00"),
        ),
      ).toBe(true);

      const [previewBatchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));
      expect(Number(previewBatchCount?.value ?? 0)).toBe(0);

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: token,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("No prices would change"),
      });

      const [batchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));
      const [auditCount] = await database
        .select({ value: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.adminUserId, admin.id),
            eq(auditLog.action, "price_change.apply"),
          ),
        );

      expect(Number(batchCount?.value ?? 0)).toBe(0);
      expect(Number(auditCount?.value ?? 0)).toBe(0);

      const unchangedProducts = await database
        .select()
        .from(products)
        .where(inArray(products.id, [first.id, second.id]));
      const byId = new Map(
        unchangedProducts.map((product) => [product.id, product]),
      );

      expect(byId.get(first.id)?.priceCents).toBe(100);
      expect(byId.get(second.id)?.priceCents).toBe(150);
    },
    60_000,
  );

  it(
    "applies only the ok rows and leaves products below the minimum untouched",
    async () => {
      const admin = await createAdmin();
      const category = await createCategory();
      const changeable = await createProduct(category.id, 1000);
      const blocked = await createProduct(category.id, 100);
      const params: PriceChangeParamsInput = {
        scope: {
          type: "category",
          category_id: category.id,
          include_children: true,
        },
        statuses: ["active"],
        mode: "amount_decrease",
        value: 50,
        apply_to: "regular",
        rounding: "none",
      };
      const { preview, okRows, token } = await tokenFor(params);

      expect(preview.counts).toEqual({
        ok: 1,
        unchanged: 0,
        blocked: 1,
      });
      expect(okRows).toHaveLength(1);
      expect(okRows[0].productId).toBe(changeable.id);

      const result = await applyPriceChange(database, {
        adminId: admin.id,
        params,
        previewToken: token,
        secret: SECRET,
      });

      expect(result.batch.itemCount).toBe(1);
      expect(result.counts).toEqual({
        ok: 1,
        unchanged: 0,
        blocked: 1,
      });

      const after = await database
        .select()
        .from(products)
        .where(inArray(products.id, [changeable.id, blocked.id]));
      const byId = new Map(
        after.map((product) => [product.id, product]),
      );

      expect(byId.get(changeable.id)?.priceCents).toBe(950);
      expect(byId.get(blocked.id)?.priceCents).toBe(100);

      const items = await database
        .select()
        .from(priceChangeItems)
        .where(eq(priceChangeItems.batchId, result.batch.id));

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        productId: changeable.id,
        oldPriceCents: 1000,
        newPriceCents: 950,
      });
      expect(
        items.some((item) => item.productId === blocked.id),
      ).toBe(false);

      const [audit] = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "price_change.apply"),
            eq(auditLog.entityId, result.batch.id),
          ),
        );

      expect(audit).toBeTruthy();
      expect(audit.details).toMatchObject({
        counts: { ok: 1, unchanged: 0, blocked: 1 },
        item_count: 1,
      });
    },
    60_000,
  );

  it(
    "blocks a sale-price conflict and writes no batch or audit row",
    async () => {
      const admin = await createAdmin();
      const category = await createCategory();
      const product = await createProduct(category.id, 1000, 900);
      const params: PriceChangeParamsInput = {
        scope: {
          type: "category",
          category_id: category.id,
          include_children: true,
        },
        statuses: ["active"],
        mode: "percent_decrease",
        value: 50,
        apply_to: "regular",
        rounding: "none",
      };
      const { preview, okRows, token } = await tokenFor(params);

      expect(preview.counts).toEqual({
        ok: 0,
        unchanged: 0,
        blocked: 1,
      });
      expect(okRows).toHaveLength(0);
      expect(preview.rows[0]?.reason).toContain(
        "no longer be below",
      );

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: token,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 400 });

      const [batchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));
      const [auditCount] = await database
        .select({ value: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.adminUserId, admin.id),
            eq(auditLog.action, "price_change.apply"),
          ),
        );

      expect(Number(batchCount?.value ?? 0)).toBe(0);
      expect(Number(auditCount?.value ?? 0)).toBe(0);

      const [unchanged] = await database
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(unchanged.priceCents).toBe(1000);
      expect(unchanged.salePriceCents).toBe(900);
    },
    60_000,
  );

  it(
    "blocks an increase above the maximum and writes nothing",
    async () => {
      const admin = await createAdmin();
      const category = await createCategory();
      const product = await createProduct(category.id, 100_000_000);
      const params: PriceChangeParamsInput = {
        scope: {
          type: "category",
          category_id: category.id,
          include_children: true,
        },
        statuses: ["active"],
        mode: "amount_increase",
        value: 1,
        apply_to: "regular",
        rounding: "none",
      };
      const { preview, okRows, token } = await tokenFor(params);

      expect(preview.counts).toEqual({
        ok: 0,
        unchanged: 0,
        blocked: 1,
      });
      expect(okRows).toHaveLength(0);
      expect(preview.rows[0]?.reason).toContain(
        "above $1,000,000.00",
      );

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: token,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 400 });

      const [batchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));
      const [auditCount] = await database
        .select({ value: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.adminUserId, admin.id),
            eq(auditLog.action, "price_change.apply"),
          ),
        );

      expect(Number(batchCount?.value ?? 0)).toBe(0);
      expect(Number(auditCount?.value ?? 0)).toBe(0);

      const [unchanged] = await database
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(unchanged.priceCents).toBe(100_000_000);
    },
    60_000,
  );

  it(
    "undo restores only products that still match and rejects a double undo",
    async () => {
      const { admin, first, second, params } = await scenario();
      const { token } = await tokenFor(params);
      const applied = await applyPriceChange(database, {
        adminId: admin.id,
        params,
        previewToken: token,
        secret: SECRET,
      });

      const [firstAfter] = await database
        .select()
        .from(products)
        .where(eq(products.id, first.id));
      const [secondAfter] = await database
        .select()
        .from(products)
        .where(eq(products.id, second.id));

      await database
        .update(products)
        .set({ priceCents: (secondAfter?.priceCents ?? 0) + 1 })
        .where(eq(products.id, second.id));

      const result = await undoPriceChangeBatch(database, {
        adminId: admin.id,
        batchId: applied.batch.id,
      });

      expect(result.restored_count).toBe(1);
      expect(result.skipped_count).toBe(1);
      expect(result.skipped[0]).toMatchObject({
        product_id: second.id,
        reason: "Changed since the price change.",
      });

      const [firstRestored] = await database
        .select()
        .from(products)
        .where(eq(products.id, first.id));
      const [secondSkipped] = await database
        .select()
        .from(products)
        .where(eq(products.id, second.id));

      expect(firstRestored.priceCents).toBe(1000);
      expect(firstAfter.priceCents).toBe(1100);
      expect(secondSkipped.priceCents).toBe(2201);

      const [batchAfter] = await database
        .select()
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.id, applied.batch.id));

      expect(batchAfter.undoneAt).toBeTruthy();
      expect(batchAfter.undoneByAdminUserId).toBe(admin.id);

      const [undoAudit] = await database
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "price_change.undo"),
            eq(auditLog.entityId, applied.batch.id),
          ),
        );

      expect(undoAudit).toBeTruthy();

      await expect(
        undoPriceChangeBatch(database, {
          adminId: admin.id,
          batchId: applied.batch.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
    },
    60_000,
  );

  it(
    "rejects tampered and expired tokens without writing a batch",
    async () => {
      const { admin, params } = await scenario();
      const { token } = await tokenFor(params);
      const tampered = `${token.slice(0, -1)}${
        token.endsWith("0") ? "1" : "0"
      }`;

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: tampered,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const expiredToken = signPriceChangePreview({
        params,
        okRows: (
          await previewPriceChange(database, params)
        ).rows.filter((row) => row.status === "ok"),
        secret: SECRET,
        now: new Date(Date.now() - 16 * 60 * 1000),
      });

      await expect(
        applyPriceChange(database, {
          adminId: admin.id,
          params,
          previewToken: expiredToken,
          secret: SECRET,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const [batchCount] = await database
        .select({ value: count() })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.adminUserId, admin.id));

      expect(Number(batchCount?.value ?? 0)).toBe(0);
    },
    60_000,
  );
});
