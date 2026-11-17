import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff",
  ordersResults: [] as Row[][],
  productResults: [] as Row[][],
  deliveryResults: [] as Row[][],
  paymentResults: [] as Row[][],
}));

vi.mock("../src/middleware/requireAdmin", () => ({
  requireAdmin: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.admin = {
      id: "00000000-0000-0000-0000-000000000001",
      role: state.role,
      email: "admin@example.com",
      name: "Admin",
    };
    next();
  },
}));

vi.mock("../src/db/client", async () => {
  const { deliveries, orders, payments, products } = await import(
    "../src/db/schema"
  );

  function rowsFor(table: unknown): Row[] {
    if (table === orders) {
      return state.ordersResults.shift() ?? [];
    }

    if (table === products) {
      return state.productResults.shift() ?? [];
    }

    if (table === deliveries) {
      return state.deliveryResults.shift() ?? [];
    }

    if (table === payments) {
      return state.paymentResults.shift() ?? [];
    }

    return [];
  }

  function selectBuilder() {
    let table: unknown = null;
    const chain = {
      from(nextTable: unknown) {
        table = nextTable;
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
      then(
        resolve: (value: Row[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(rowsFor(table)).then(resolve, reject);
      },
    };

    return chain;
  }

  return {
    db: {
      select: () => selectBuilder(),
    },
    connection: null,
  };
});

import { adminDashboardRouter } from "../src/routes/adminDashboard";

function businessRows() {
  const now = Date.now();
  const within24h = new Date(now - 60 * 60 * 1000);
  const within7d = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const outside = new Date(now - 10 * 24 * 60 * 60 * 1000);

  return { now, within24h, within7d, outside };
}

function seedBaseQueries() {
  state.ordersResults.push([{ value: 2 }]);
  state.ordersResults.push([{ value: 1 }]);
  state.ordersResults.push([{ value: 3 }]);
  state.ordersResults.push([
    {
      orderNumber: "ZF-100002",
      shippingName: null,
      customerName: "Ada Lovelace",
      totalCents: 12345,
      status: "paid",
      createdAt: new Date("2026-11-17T10:00:00.000Z"),
    },
  ]);

  state.productResults.push([
    {
      id: "p1",
      name: "Oak Chair",
      sku: "OAK-1",
      stockQty: 2,
      threshold: 3,
    },
  ]);
  state.productResults.push([{ value: 1 }]);
  state.productResults.push([
    {
      id: "p2",
      name: "Linen Sofa",
      sku: null,
      stockQty: 0,
      threshold: 2,
    },
  ]);
  state.productResults.push([{ value: 1 }]);

  state.deliveryResults.push([
    {
      orderNumber: "ZF-100003",
      shippingName: "Grace Hopper",
      customerName: null,
      scheduledDate: "2026-11-19",
      timeWindow: "9am-12pm",
      deliveryStatus: "scheduled",
    },
  ]);
}

function seedOwnerQueries() {
  const { within24h, within7d, outside } = businessRows();

  state.ordersResults.push([
    { status: "paid", paidAt: within24h, totalCents: 12300 },
    { status: "delivered", paidAt: within7d, totalCents: 5000 },
    {
      status: "pending",
      paidAt: new Date(within24h.getTime() + 1000),
      totalCents: 9999,
    },
    { status: "cancelled", paidAt: within24h, totalCents: 7777 },
    { status: "paid", paidAt: outside, totalCents: 4000 },
  ]);

  state.paymentResults.push([
    { status: "refunded", createdAt: within24h, amountCents: 1000 },
    { status: "refunded", createdAt: within7d, amountCents: 2000 },
    { status: "refunded", createdAt: outside, amountCents: 3000 },
    { status: "succeeded", createdAt: within24h, amountCents: 5000 },
  ]);
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  state.role = "owner";
  state.ordersResults.length = 0;
  state.productResults.length = 0;
  state.deliveryResults.length = 0;
  state.paymentResults.length = 0;

  const app = express();
  app.use(express.json());
  app.use("/admin", adminDashboardRouter);

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

describe("GET /admin/dashboard", () => {
  it("returns owner metrics and dashboard lists", async () => {
    seedBaseQueries();
    seedOwnerQueries();

    const response = await fetch(`${baseUrl}/admin/dashboard`);
    const body = (await response.json()) as Record<string, unknown> & {
      needs_attention: Record<string, number>;
      low_stock: { total: number; items: Array<Record<string, unknown>> };
      out_of_stock: { total: number };
      upcoming_deliveries: Array<Record<string, unknown>>;
      recent_orders: Array<Record<string, unknown>>;
      sales_last_24h: Record<string, number>;
      sales_last_7d: Record<string, number>;
      refunded_last_24h_cents: number;
      refunded_last_7d_cents: number;
    };

    expect(response.status).toBe(200);
    expect(body.needs_attention).toEqual({
      new_orders_waiting: 2,
      stock_shortage_orders: 1,
      deliveries_unscheduled: 3,
    });
    expect(body.low_stock.total).toBe(1);
    expect(body.low_stock.items[0]).toMatchObject({
      name: "Oak Chair",
      stock_qty: 2,
      threshold: 3,
    });
    expect(body.out_of_stock.total).toBe(1);
    expect(body.upcoming_deliveries[0]).toMatchObject({
      order_number: "ZF-100003",
      customer_name: "Grace Hopper",
      scheduled_date: "2026-11-19",
      delivery_status: "scheduled",
    });
    expect(body.recent_orders[0]).toMatchObject({
      order_number: "ZF-100002",
      customer_name: "Ada Lovelace",
      total_cents: 12345,
      status: "paid",
    });
    expect(body.sales_last_24h).toEqual({
      orders_count: 1,
      sales_before_refunds_cents: 12300,
    });
    expect(body.sales_last_7d).toEqual({
      orders_count: 2,
      sales_before_refunds_cents: 17300,
    });
    expect(body.refunded_last_24h_cents).toBe(1000);
    expect(body.refunded_last_7d_cents).toBe(3000);
  });

  it("omits owner-only sales keys for staff", async () => {
    state.role = "staff";
    seedBaseQueries();

    const response = await fetch(`${baseUrl}/admin/dashboard`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("sales_last_24h");
    expect(body).not.toHaveProperty("sales_last_7d");
    expect(body).not.toHaveProperty("refunded_last_24h_cents");
    expect(body).not.toHaveProperty("refunded_last_7d_cents");
    expect(body).toHaveProperty("needs_attention");
    expect(body).toHaveProperty("recent_orders");
  });
});
