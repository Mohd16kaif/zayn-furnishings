import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeRefundDb,
  createFakeRefundState,
  type FakeRefundState,
} from "./helpers/fakeRefundDb";

const mock = vi.hoisted(() => ({
  db: null as unknown,
  event: null as unknown,
}));

vi.mock("../src/config/env", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 4000,
    STRIPE_SECRET_KEY: "sk_test_mock",
    STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
    WEB_ORIGIN: "http://localhost:3000",
  },
}));

vi.mock("../src/db/client", () => ({
  get db() {
    return mock.db;
  },
  connection: null,
}));

vi.mock("../src/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: () => mock.event,
    },
  },
}));

import { stripeWebhookRouter } from "../src/routes/webhooks";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "ZF-100001",
    status: "paid",
    totalCents: 10000,
    stripePaymentIntentId: "pi_123",
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function succeededPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    orderId: "order-1",
    provider: "stripe",
    providerPaymentId: "pi_123",
    amountCents: 10000,
    currency: "usd",
    status: "succeeded",
    rawEventId: "pi_succeeded:pi_123",
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function chargeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    created: 1763031600,
    data: {
      object: {
        payment_intent: "pi_123",
        amount_refunded: 5000,
        currency: "usd",
        refunds: { data: [] },
        ...overrides,
      },
    },
  };
}

let server: Server;
let baseUrl: string;
let state: FakeRefundState;

beforeEach(async () => {
  state = createFakeRefundState({
    orders: [orderRow()],
    payments: [succeededPayment()],
    deliveries: [{ id: "delivery-1", orderId: "order-1", status: "pending" }],
    orderItems: [
      {
        id: "item-1",
        orderId: "order-1",
        productId: "product-1",
        nameSnapshot: "Oak Chair",
        quantity: 1,
      },
    ],
    products: [{ id: "product-1", name: "Oak Chair", stockQty: 3 }],
  });
  mock.db = createFakeRefundDb(state);
  mock.event = chargeEvent();

  const app = express();
  app.use("/webhooks", stripeWebhookRouter);

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

async function postWebhook() {
  return fetch(`${baseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=mock",
    },
    body: JSON.stringify({ mock: true }),
  });
}

describe("charge.refunded webhook", () => {
  it("uses the shared ledger for a dashboard-only refund without restocking", async () => {
    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(state.payments).toHaveLength(2);
    expect(state.payments[1]).toMatchObject({
      amountCents: 5000,
      status: "refunded",
      rawEventId: "refund_event:evt_refund_1",
    });
    expect(state.orders[0].status).toBe("partially_refunded");
    expect(state.stockMovements).toHaveLength(0);
    expect(state.products[0].stockQty).toBe(3);
    expect(state.deliveries[0].status).toBe("pending");
  });

  it("is a no-op when the same event is replayed", async () => {
    await postWebhook();
    const replay = await postWebhook();

    expect(replay.status).toBe(200);
    expect(state.payments).toHaveLength(2);
    expect(state.orders[0].status).toBe("partially_refunded");
  });

  it("records known refund ids and can fully refund an order", async () => {
    mock.event = chargeEvent({
      amount_refunded: 10000,
      refunds: {
        data: [
          {
            id: "re_full",
            amount: 10000,
            status: "succeeded",
            created: 1763031600,
          },
        ],
      },
    });
    mock.event = {
      ...(mock.event as Record<string, unknown>),
      id: "evt_refund_full",
    };

    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(state.payments).toHaveLength(2);
    expect(state.payments[1]).toMatchObject({
      amountCents: 10000,
      status: "refunded",
      rawEventId: "refund:re_full",
    });
    expect(state.orders[0].status).toBe("refunded");
    expect(state.deliveries[0].status).toBe("cancelled");
    expect(state.stockMovements).toHaveLength(0);
  });
});
