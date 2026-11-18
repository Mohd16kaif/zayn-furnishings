import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  settings: [{ key: "store_open", value: false }] as Row[],
}));

vi.mock("../src/config/env", () => ({
  env: {
    NODE_ENV: "test",
    APP_ENV: "production",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
  },
}));

vi.mock("../src/db/client", async () => {
  const { storeSettings } = await import("../src/db/schema");

  function selectBuilder() {
    let table: unknown = null;
    const chain = {
      from(nextTable: unknown) {
        table = nextTable;
        return chain;
      },
      then(
        resolve: (value: Row[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        const rows = table === storeSettings ? state.settings : [];

        return Promise.resolve(rows).then(resolve, reject);
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

vi.mock("../src/lib/customerAuth", () => ({
  requireCustomer: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.customer = { id: "11111111-1111-4111-8111-111111111112" };
    next();
  },
}));

vi.mock("../src/lib/stripe", () => ({
  stripe: null,
  STRIPE_API_VERSION: "2024-06-20",
}));

vi.mock("../src/lib/reconcileOrderPayment", () => ({
  reconcileOrderPayment: vi.fn(),
}));

import { ordersRouter } from "../src/routes/orders";

const orderBody = {
  items: [
    {
      product_id: "11111111-1111-4111-8111-111111111111",
      quantity: 1,
    },
  ],
  zip: "11201",
  email: "customer@example.com",
  shipping_address: {
    name: "Jordan Lee",
    line1: "1 Main St",
    city: "Brooklyn",
    state: "NY",
    zip: "11201",
  },
};

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  state.settings = [{ key: "store_open", value: false }];

  const app = express();
  app.use(express.json());
  app.use("/api", ordersRouter);

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

describe("POST /api/orders while the store is closed", () => {
  it("rejects order creation with 503 and a plain-language message", async () => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "The store is not open yet." });
  });

  it("passes the closed-store gate when store_open is true", async () => {
    state.settings = [{ key: "store_open", value: true }];

    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe("Online payments are temporarily unavailable.");
  });
});
