import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  productResults: [] as Row[][],
  imageRows: [] as Row[],
  categoryRows: [] as Row[],
}));

vi.mock("../src/db/client", async () => {
  const { categories, productImages, products } = await import(
    "../src/db/schema"
  );

  function rowsFor(table: unknown, projection?: Row): Row[] {
    if (table === products) {
      const rows = state.productResults.shift() ?? [];

      if (projection && "product" in projection) {
        return rows;
      }

      return rows.map((row) => (row.product as Row | undefined) ?? row);
    }

    if (table === productImages) {
      return state.imageRows;
    }

    if (table === categories) {
      return state.categoryRows;
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
      orderBy() {
        return chain;
      },
      limit() {
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
    },
    connection: null,
  };
});

import { publicRouter } from "../src/routes/public";

function productRow(
  productOverrides: Row = {},
): Row {
  return {
    product: {
      id: "11111111-1111-4111-8111-111111111111",
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
      ...productOverrides,
    },
    categoryName: null,
    categorySlug: null,
  };
}

function product(overrides: Row): Row {
  return productRow(overrides);
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, keys);
    }

    return keys;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }

  return keys;
}

function expectNoStockFields(value: unknown): void {
  const keys = collectKeys(value);

  expect(keys).not.toContain("stock_qty");
  expect(keys).not.toContain("stockQty");
  expect(JSON.stringify(value)).not.toContain("stock_qty");
  expect(JSON.stringify(value)).not.toContain("stockQty");
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  state.productResults.length = 0;
  state.imageRows.length = 0;
  state.categoryRows.length = 0;

  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

describe("public product quantity visibility", () => {
  it("caps max_order_qty at ten and never exposes stock_qty", async () => {
    state.productResults.push([
      productRow({ stockQty: 500, slug: "oversized-sofa" }),
    ]);
    state.productResults.push([]);

    const response = await fetch(
      `${baseUrl}/api/public/products/oversized-sofa`,
    );
    const body = (await response.json()) as {
      max_order_qty: number;
    };

    expect(response.status).toBe(200);
    expect(body.max_order_qty).toBe(10);
    expectNoStockFields(body);
  });

  it("returns the real stock quantity as max_order_qty when below ten", async () => {
    state.productResults.push([
      productRow({ stockQty: 3, slug: "oak-chair" }),
    ]);
    state.productResults.push([]);

    const response = await fetch(`${baseUrl}/api/public/products/oak-chair`);
    const body = (await response.json()) as {
      max_order_qty: number;
    };

    expect(response.status).toBe(200);
    expect(body.max_order_qty).toBe(3);
    expectNoStockFields(body);
  });
});

describe("public cart validation quantity clamping", () => {
  it("clamps each line to available stock and prices the clamped quantity", async () => {
    const limitedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ampleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const soldOutId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    state.productResults.push([
      product({ id: limitedId, slug: "limited", stockQty: 3 }),
      product({ id: ampleId, slug: "ample", stockQty: 500 }),
      product({ id: soldOutId, slug: "sold-out", stockQty: 0 }),
    ]);

    const response = await fetch(`${baseUrl}/api/public/cart/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { product_id: limitedId, quantity: 5 },
          { product_id: ampleId, quantity: 10 },
          { product_id: soldOutId, quantity: 2 },
        ],
      }),
    });
    const body = (await response.json()) as {
      items: Array<{
        id: string;
        in_stock: boolean;
        max_qty: number;
        clamped_qty: number;
        qty_adjusted: boolean;
      }>;
      unavailable: string[];
      subtotal_cents: number;
      delivery: unknown;
    };

    expect(response.status).toBe(200);

    const limited = body.items.find((item) => item.id === limitedId);
    const ample = body.items.find((item) => item.id === ampleId);
    const soldOut = body.items.find((item) => item.id === soldOutId);

    expect(limited).toMatchObject({
      max_qty: 3,
      clamped_qty: 3,
      qty_adjusted: true,
    });
    expect(ample).toMatchObject({
      max_qty: 10,
      clamped_qty: 10,
      qty_adjusted: false,
    });
    expect(soldOut).toMatchObject({
      in_stock: false,
      max_qty: 0,
      clamped_qty: 0,
      qty_adjusted: true,
    });

    for (const item of body.items) {
      expect(item.max_qty).toBeGreaterThanOrEqual(0);
      expect(item.max_qty).toBeLessThanOrEqual(10);
    }

    expect(body.subtotal_cents).toBe(3 * 10000 + 10 * 10000);
    expect(body.unavailable).toEqual([]);
    expectNoStockFields(body);
  });
});
