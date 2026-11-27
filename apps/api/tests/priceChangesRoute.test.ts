import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderItems, orders } from "../src/db/schema";
import type { PriceChangeParamsInput } from "../src/lib/priceChanges";
import {
  PRICE_CHANGE_PREVIEW_TTL_MS,
  signPriceChangePreview,
} from "../src/lib/priceChangeToken";

const SECRET = vi.hoisted(
  () => `test-price-change-route-secret-${"x".repeat(16)}`,
);

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff",
  selectResults: [] as unknown[][],
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  updates: [] as Array<{ table: unknown; values: Row }>,
  writes: 0,
}));

vi.mock("../src/config/env", () => ({
  env: {
    ADMIN_AUTH_SECRET: SECRET,
    APP_ENV: "development",
    NODE_ENV: "test",
  },
}));

vi.mock("../src/middleware/requireAdmin", () => ({
  requireAdmin: (
    req: Record<string, unknown> & {
      get?: (name: string) => string | undefined;
      admin?: unknown;
    },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.get?.("x-admin-session")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.admin = {
      id: "admin-1",
      email: "owner@example.com",
      name: "Owner",
      role: state.role,
    };
    next();
  },
  requireRole: (role: string) => (
    req: { admin?: { role: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.admin) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (req.admin.role !== role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  },
}));

vi.mock("../src/db/client", async () => {
  const schema = await import("../src/db/schema");

  function selectBuilder() {
    const chain = {
      from() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      innerJoin() {
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
      for() {
        return chain;
      },
      then(
        resolve: (value: Row[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(
          (state.selectResults.shift() ?? []) as Row[],
        ).then(resolve, reject);
      },
    };

    return chain;
  }

  function insertBuilder(table: unknown) {
    return {
      values(values: unknown) {
        state.inserts.push({ table, values });
        state.writes += 1;
        const result =
          table === schema.priceChangeBatches
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  createdAt: new Date("2026-05-01T12:00:00.000Z"),
                  undoneAt: null,
                  ...(values as Row),
                },
              ]
            : undefined;
        const promise = Promise.resolve(result);

        return {
          returning: () => promise,
          then(
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) {
            return promise.then(resolve, reject);
          },
          catch(reject: (reason: unknown) => unknown) {
            return promise.catch(reject);
          },
        };
      },
    };
  }

  function updateBuilder(table: unknown) {
    return {
      set(values: Row) {
        return {
          where() {
            state.updates.push({ table, values });
            state.writes += 1;

            if (table === schema.priceChangeBatches) {
              return {
                returning: () =>
                  Promise.resolve([
                    {
                      id: "00000000-0000-4000-8000-000000000010",
                      ...values,
                    },
                  ]),
              };
            }

            return Promise.resolve(undefined);
          },
        };
      },
    };
  }

  const db = {
    select: () => selectBuilder(),
    insert: (table: unknown) => insertBuilder(table),
    update: (table: unknown) => updateBuilder(table),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    execute: async () => undefined,
  };

  return { db, connection: null };
});

import { adminPriceChangesRouter } from "../src/routes/adminPriceChanges";

const PARAMS: PriceChangeParamsInput = {
  scope: { type: "all" },
  statuses: ["active"],
  mode: "percent_increase",
  value: 10,
  apply_to: "regular",
  rounding: "none",
};

function productRow(
  id: string,
  priceCents: number,
  salePriceCents: number | null = null,
  overrides: Row = {},
): Row {
  return {
    id,
    name: `Product ${id}`,
    priceCents,
    salePriceCents,
    status: "active",
    categoryId: null,
    ...overrides,
  };
}

function batchRow(overrides: Row = {}): Row {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    adminUserId: "admin-1",
    params: {},
    itemCount: 2,
    createdAt: new Date("2026-05-01T11:00:00.000Z"),
    undoneAt: null,
    undoneByAdminUserId: null,
    ...overrides,
  };
}

function itemRow(
  productId: string,
  oldPriceCents: number,
  oldSalePriceCents: number | null,
  newPriceCents: number,
  newSalePriceCents: number | null,
  id = `item-${productId}`,
): Row {
  return {
    id,
    batchId: "00000000-0000-4000-8000-000000000010",
    productId,
    oldPriceCents,
    oldSalePriceCents,
    newPriceCents,
    newSalePriceCents,
  };
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  state.role = "owner";
  state.selectResults.length = 0;
  state.inserts.length = 0;
  state.updates.length = 0;
  state.writes = 0;

  const app = express();
  app.use(express.json());
  app.use("/admin", adminPriceChangesRouter);

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

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-session": "session-token",
  };
}

async function preview(
  params: PriceChangeParamsInput = PARAMS,
  extraHeaders: Record<string, string> = headers(),
) {
  return fetch(`${baseUrl}/admin/price-changes/preview`, {
    method: "POST",
    headers: extraHeaders,
    body: JSON.stringify(params),
  });
}

async function apply(
  params: PriceChangeParamsInput,
  previewToken: string,
) {
  return fetch(`${baseUrl}/admin/price-changes/apply`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ params, preview_token: previewToken }),
  });
}

async function previewToken(
  params: PriceChangeParamsInput,
  rows: Row[],
  now?: Date,
) {
  state.selectResults.push(rows);
  const response = await preview(params);
  const body = (await response.json()) as {
    preview_token: string;
    rows: Array<{
      product_id: string;
      name: string;
      category_id: string | null;
      product_status: "active" | "draft" | "archived";
      old_price_cents: number;
      old_sale_price_cents: number | null;
      new_price_cents: number;
      new_sale_price_cents: number | null;
      status: "ok" | "unchanged" | "blocked";
      reason: string | null;
    }>;
  };

  if (now) {
    return signPriceChangePreview({
      params,
      okRows: body.rows
        .filter((row) => row.status === "ok")
        .map((row) => ({
          productId: row.product_id,
          name: row.name,
          categoryId: row.category_id,
          productStatus: row.product_status,
          oldPrice: row.old_price_cents,
          oldSale: row.old_sale_price_cents,
          newPrice: row.new_price_cents,
          newSale: row.new_sale_price_cents,
          status: "ok" as const,
          reason: null,
        })),
      secret: SECRET,
      now,
    });
  }

  return body.preview_token;
}

describe("admin price change authorization", () => {
  it("allows the owner to preview", async () => {
    state.selectResults.push([productRow("p1", 1000)]);

    const response = await preview();
    const body = (await response.json()) as { counts: Row };

    expect(response.status).toBe(200);
    expect(body.counts).toEqual({ ok: 1, unchanged: 0, blocked: 0 });
  });

  it("returns 403 for staff", async () => {
    state.role = "staff";

    const response = await preview();

    expect(response.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const response = await preview(PARAMS, {
      "content-type": "application/json",
    });

    expect(response.status).toBe(401);
  });
});

describe("admin price change preview and apply", () => {
  it("never writes during preview", async () => {
    state.selectResults.push([productRow("p1", 1000)]);

    const response = await preview();

    expect(response.status).toBe(200);
    expect(state.writes).toBe(0);
  });

  it("applies only ok rows and writes the batch, items and audit", async () => {
    const rows = [productRow("p1", 1000), productRow("p2", 2000)];
    const token = await previewToken(PARAMS, rows);
    state.selectResults.push(rows);

    const response = await apply(PARAMS, token);
    const body = (await response.json()) as {
      item_count: number;
      counts: Row;
    };

    expect(response.status).toBe(200);
    expect(body.item_count).toBe(2);
    expect(body.counts).toEqual({ ok: 2, unchanged: 0, blocked: 0 });
    expect(
      state.updates.filter((entry) => entry.values.priceCents !== undefined),
    ).toHaveLength(2);
    expect(state.inserts).toHaveLength(3);
    expect(state.inserts[1].values).toEqual([
      expect.objectContaining({
        productId: "p1",
        oldPriceCents: 1000,
        newPriceCents: 1100,
      }),
      expect.objectContaining({
        productId: "p2",
        oldPriceCents: 2000,
        newPriceCents: 2200,
      }),
    ]);
    expect(
      state.inserts.some(
        (entry) =>
          JSON.stringify(entry.values).includes("price_change.apply") &&
          JSON.stringify(entry.values).includes('"item_count":2'),
      ),
    ).toBe(true);
    expect(
      state.inserts.every(
        (entry) => entry.table !== orders && entry.table !== orderItems,
      ),
    ).toBe(true);
    expect(
      state.updates.every(
        (entry) => entry.table !== orders && entry.table !== orderItems,
      ),
    ).toBe(true);
  });

  it("returns 409 when prices changed after the preview and writes nothing", async () => {
    const token = await previewToken(PARAMS, [productRow("p1", 1000)]);
    state.writes = 0;
    state.inserts.length = 0;
    state.updates.length = 0;
    state.selectResults.push([productRow("p1", 1050)]);

    const response = await apply(PARAMS, token);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("Prices changed since you previewed");
    expect(state.writes).toBe(0);
  });

  it("rejects an empty batch", async () => {
    const saleParams: PriceChangeParamsInput = {
      ...PARAMS,
      apply_to: "sale",
    };
    const rows = [productRow("p1", 1000, null)];
    const token = await previewToken(saleParams, rows);
    state.selectResults.push(rows);

    const response = await apply(saleParams, token);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("No prices would change");
    expect(state.writes).toBe(0);
  });

  it("rejects more than 500 products", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      productRow(`p${index}`, 1000),
    );
    state.selectResults.push(rows);

    const response = await preview();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("more than 500 products");
  });

  it("previews all rows blocked below the minimum and refuses to apply", async () => {
    const params: PriceChangeParamsInput = {
      ...PARAMS,
      mode: "amount_decrease",
      value: 200,
      apply_to: "regular",
    };
    const rows = [productRow("p1", 100), productRow("p2", 150)];
    state.selectResults.push(rows);

    const previewResponse = await preview(params);
    const previewBody = (await previewResponse.json()) as {
      preview_token: string;
      counts: Row;
      rows: Array<{ status: string; reason: string | null }>;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.counts).toEqual({
      ok: 0,
      unchanged: 0,
      blocked: 2,
    });
    expect(previewBody.rows).toHaveLength(2);
    expect(
      previewBody.rows.every((row) => row.status === "blocked"),
    ).toBe(true);
    expect(
      previewBody.rows.every((row) =>
        row.reason?.includes("below $1.00"),
      ),
    ).toBe(true);
    expect(state.writes).toBe(0);

    state.selectResults.push(rows);

    const applyResponse = await apply(
      params,
      previewBody.preview_token,
    );
    const applyBody = (await applyResponse.json()) as {
      error: string;
    };

    expect(applyResponse.status).toBe(400);
    expect(applyBody.error).toContain("No prices would change");
    expect(state.writes).toBe(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("applies only ok rows when some products fall below the minimum", async () => {
    const params: PriceChangeParamsInput = {
      ...PARAMS,
      mode: "amount_decrease",
      value: 50,
      apply_to: "regular",
    };
    const rows = [productRow("p1", 1000), productRow("p2", 100)];
    const token = await previewToken(params, rows);
    state.selectResults.push(rows);

    const response = await apply(params, token);
    const body = (await response.json()) as {
      item_count: number;
      counts: Row;
    };

    expect(response.status).toBe(200);
    expect(body.item_count).toBe(1);
    expect(body.counts).toEqual({ ok: 1, unchanged: 0, blocked: 1 });
    expect(
      state.updates.filter(
        (entry) => entry.values.priceCents !== undefined,
      ),
    ).toEqual([
      expect.objectContaining({
        values: { priceCents: 950, salePriceCents: null },
      }),
    ]);
    expect(state.inserts[1].values).toEqual([
      expect.objectContaining({
        productId: "p1",
        oldPriceCents: 1000,
        newPriceCents: 950,
      }),
    ]);
    expect(
      state.inserts.some(
        (entry) =>
          JSON.stringify(entry.values).includes("price_change.apply") &&
          JSON.stringify(entry.values).includes('"blocked":1'),
      ),
    ).toBe(true);
  });

  it("previews a sale conflict as blocked and refuses to apply", async () => {
    const params: PriceChangeParamsInput = {
      ...PARAMS,
      mode: "percent_decrease",
      value: 50,
      apply_to: "regular",
    };
    const rows = [
      productRow("p1", 1000, 900),
      productRow("p2", 2000, 1500),
    ];
    state.selectResults.push(rows);

    const previewResponse = await preview(params);
    const previewBody = (await previewResponse.json()) as {
      preview_token: string;
      counts: Row;
      rows: Array<{ status: string; reason: string | null }>;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.counts).toEqual({
      ok: 0,
      unchanged: 0,
      blocked: 2,
    });
    expect(
      previewBody.rows.every(
        (row) =>
          row.status === "blocked" &&
          row.reason?.includes("no longer be below"),
      ),
    ).toBe(true);

    state.selectResults.push(rows);

    const applyResponse = await apply(
      params,
      previewBody.preview_token,
    );
    const applyBody = (await applyResponse.json()) as {
      error: string;
    };

    expect(applyResponse.status).toBe(400);
    expect(applyBody.error).toContain("No prices would change");
    expect(state.writes).toBe(0);
  });

  it("previews an increase above the maximum as blocked and refuses to apply", async () => {
    const params: PriceChangeParamsInput = {
      ...PARAMS,
      mode: "amount_increase",
      value: 1,
      apply_to: "regular",
    };
    const rows = [productRow("p1", 100_000_000)];
    state.selectResults.push(rows);

    const previewResponse = await preview(params);
    const previewBody = (await previewResponse.json()) as {
      preview_token: string;
      counts: Row;
      rows: Array<{ status: string; reason: string | null }>;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.counts).toEqual({
      ok: 0,
      unchanged: 0,
      blocked: 1,
    });
    expect(previewBody.rows[0].reason).toContain(
      "above $1,000,000.00",
    );

    state.selectResults.push(rows);

    const applyResponse = await apply(
      params,
      previewBody.preview_token,
    );
    const applyBody = (await applyResponse.json()) as {
      error: string;
    };

    expect(applyResponse.status).toBe(400);
    expect(applyBody.error).toContain("No prices would change");
    expect(state.writes).toBe(0);
  });

  it("rejects a tampered token", async () => {
    const token = await previewToken(PARAMS, [productRow("p1", 1000)]);
    const tampered = `${token.slice(0, -1)}${
      token.endsWith("0") ? "1" : "0"
    }`;
    state.selectResults.push([productRow("p1", 1000)]);

    const response = await apply(PARAMS, tampered);

    expect(response.status).toBe(409);
  });

  it("rejects an expired token", async () => {
    const token = await previewToken(
      PARAMS,
      [productRow("p1", 1000)],
      new Date(Date.now() - PRICE_CHANGE_PREVIEW_TTL_MS - 1000),
    );
    state.selectResults.push([productRow("p1", 1000)]);

    const response = await apply(PARAMS, token);

    expect(response.status).toBe(409);
  });
});

describe("admin price change undo", () => {
  it("restores only products that still match the batch and audits the undo", async () => {
    state.selectResults.push([batchRow()]);
    state.selectResults.push([
      itemRow("p1", 1000, null, 1100, null),
      itemRow("p2", 2000, null, 2200, null),
    ]);
    state.selectResults.push([
      productRow("p1", 1100),
      productRow("p2", 2300),
    ]);

    const response = await fetch(
      `${baseUrl}/admin/price-changes/00000000-0000-4000-8000-000000000010/undo`,
      { method: "POST", headers: headers() },
    );
    const body = (await response.json()) as {
      restored_count: number;
      skipped_count: number;
      skipped: Array<{ reason: string; product_id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.restored_count).toBe(1);
    expect(body.skipped_count).toBe(1);
    expect(body.skipped[0]).toMatchObject({
      product_id: "p2",
      reason: "Changed since the price change.",
    });
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: { priceCents: 1000, salePriceCents: null },
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            undoneByAdminUserId: "admin-1",
          }),
        }),
      ]),
    );
    expect(
      state.inserts.some((entry) =>
        JSON.stringify(entry.values).includes("price_change.undo"),
      ),
    ).toBe(true);
  });

  it("returns 409 when the batch was already undone", async () => {
    state.selectResults.push([
      batchRow({ undoneAt: new Date("2026-05-01T12:30:00.000Z") }),
    ]);

    const response = await fetch(
      `${baseUrl}/admin/price-changes/00000000-0000-4000-8000-000000000010/undo`,
      { method: "POST", headers: headers() },
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("already been undone");
    expect(state.writes).toBe(0);
  });
});
