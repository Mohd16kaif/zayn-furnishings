import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeOrderIdempotencyFingerprint } from "../src/lib/orderIdempotency";
import {
  createFakeOrderDb,
  createFakeOrderState,
  type FakeOrderState,
} from "./helpers/fakeOrderDb";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111112";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222223";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mock = vi.hoisted(() => ({
  customerId: "11111111-1111-4111-8111-111111111112",
  db: null as unknown,
  createPaymentIntent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
}));

vi.mock("../src/db/client", () => ({
  get db() {
    return mock.db;
  },
  connection: null,
}));

vi.mock("../src/lib/customerAuth", () => ({
  requireCustomer: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.customer = { id: mock.customerId };
    next();
  },
}));

vi.mock("../src/lib/storeSettings", () => ({
  readStoreSettings: vi.fn(async () => ({
    store_name: "Zayn Furnishings",
    phone: "",
    email: "",
    free_delivery_threshold_cents: null,
    show_financing: false,
    store_open: true,
  })),
}));

vi.mock("../src/lib/deliveryPricing", () => ({
  computeDeliveryQuote: vi.fn(async () => ({
    zone: { id: "zone-1" },
    computation: { feeCents: 0 },
  })),
}));

vi.mock("../src/lib/productImages", () => ({
  primaryImagesByProduct: vi.fn(async () => new Map()),
}));

vi.mock("../src/lib/stripe", () => ({
  STRIPE_API_VERSION: "2024-06-20",
  stripe: {
    paymentIntents: {
      create: mock.createPaymentIntent,
      retrieve: mock.retrievePaymentIntent,
    },
  },
}));

import { ordersRouter } from "../src/routes/orders";

const body = {
  items: [{ product_id: PRODUCT_ID, quantity: 1 }],
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

function fingerprintFor(value = body): string {
  return computeOrderIdempotencyFingerprint({
    items: value.items,
    zip: value.zip,
    email: value.email,
    shipping_address: value.shipping_address,
    discount_code: null,
  });
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "existing-order",
    orderNumber: "ZF-TEST-9001",
    customerId: CUSTOMER_A,
    email: "customer@example.com",
    status: "pending",
    subtotalCents: 1000,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    totalCents: 1000,
    discountCode: null,
    stripePaymentIntentId: "pi_existing",
    idempotencyKey: KEY,
    idempotencyFingerprint: fingerprintFor(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;
let state: FakeOrderState;
let ipCounter = 0;

beforeEach(async () => {
  mock.customerId = CUSTOMER_A;
  mock.createPaymentIntent.mockReset();
  mock.retrievePaymentIntent.mockReset();
  mock.createPaymentIntent.mockResolvedValue({
    id: "pi_created",
    client_secret: "secret_created",
  });
  mock.retrievePaymentIntent.mockResolvedValue({
    id: "pi_existing",
    client_secret: "secret_existing",
  });

  state = createFakeOrderState({
    customerId: CUSTOMER_A,
    customers: [
      {
        id: CUSTOMER_A,
        name: "Jordan Lee",
        phone: "+12125550142",
      },
      {
        id: CUSTOMER_B,
        name: "Other Customer",
        phone: "+12125550143",
      },
    ],
    products: [
      {
        id: PRODUCT_ID,
        name: "Oak Chair",
        slug: "oak-chair",
        sku: "CHAIR-1",
        priceCents: 1000,
        salePriceCents: null,
        stockQty: 5,
        status: "active",
      },
    ],
  });
  mock.db = createFakeOrderDb(state);

  const app = express();
  app.set("trust proxy", true);
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
  vi.restoreAllMocks();
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

async function postOrder(
  value: unknown = body,
  key: string | null = KEY,
) {
  state.customerId = mock.customerId;
  ipCounter += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${ipCounter}`,
  };

  if (key !== null) {
    headers["idempotency-key"] = key;
  }

  return fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
}

describe("POST /api/orders idempotency", () => {
  it("requires a UUID v4 Idempotency-Key", async () => {
    const missing = await postOrder(body, null);
    const malformed = await postOrder(body, "not-a-uuid");

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "A valid Idempotency-Key header is required.",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "A valid Idempotency-Key header is required.",
    });
    expect(state.orders).toHaveLength(0);
    expect(mock.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("creates exactly one order and one PaymentIntent on the first request", async () => {
    const response = await postOrder();
    const responseBody = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
    expect(responseBody).toMatchObject({
      order_number: "ZF-TEST-1",
      client_secret: "secret_created",
      total_cents: 1000,
    });
    expect(state.orders).toHaveLength(1);
    expect(state.orderItems).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      idempotencyKey: KEY,
      idempotencyFingerprint: fingerprintFor(),
      stripePaymentIntentId: "pi_created",
    });
    expect(mock.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mock.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it("replays the same order without inserting or creating another PaymentIntent", async () => {
    const first = await postOrder();
    const firstBody = await first.json();
    const second = await postOrder();
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(secondBody.order_number).toBe(firstBody.order_number);
    expect(secondBody.total_cents).toBe(firstBody.total_cents);
    expect(secondBody.client_secret).toBe("secret_existing");
    expect(state.orders).toHaveLength(1);
    expect(state.orderItems).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(mock.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mock.retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(mock.retrievePaymentIntent).toHaveBeenCalledWith("pi_created");
  });

  it("rejects a changed fingerprint with 422 and creates nothing", async () => {
    await postOrder();
    const changed = {
      ...body,
      items: [{ product_id: PRODUCT_ID, quantity: 2 }],
    };
    const response = await postOrder(changed);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "This checkout changed. Please try again.",
    });
    expect(state.orders).toHaveLength(1);
    expect(mock.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it.each(["paid", "processing", "cancelled", "refunded"])(
    "returns 409 without a client secret for a %s order",
    async (status) => {
      state.orders.push(orderRow({ status }));

      const response = await postOrder();
      const responseBody = await response.json();

      expect(response.status).toBe(409);
      expect(responseBody).toEqual({
        error: "This order can no longer be paid. Order ZF-TEST-9001.",
        order_number: "ZF-TEST-9001",
      });
      expect(responseBody).not.toHaveProperty("client_secret");
      expect(mock.retrievePaymentIntent).not.toHaveBeenCalled();
      expect(mock.createPaymentIntent).not.toHaveBeenCalled();
    },
  );

  it("returns 502 when the existing PaymentIntent cannot be retrieved and creates nothing", async () => {
    state.orders.push(orderRow());
    mock.retrievePaymentIntent.mockRejectedValueOnce(
      new Error("Stripe retrieval failed"),
    );

    const response = await postOrder();
    const responseBody = await response.json();

    expect(response.status).toBe(502);
    expect(responseBody).toEqual({
      error: "We could not reload your existing payment. Please try again.",
      order_number: "ZF-TEST-9001",
    });
    expect(responseBody).not.toHaveProperty("client_secret");
    expect(state.orders).toHaveLength(1);
    expect(mock.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("frees the key when Stripe fails and allows a fresh order with the same key", async () => {
    mock.createPaymentIntent
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce({
        id: "pi_retry",
        client_secret: "secret_retry",
      });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const failed = await postOrder();
    expect(failed.status).toBe(502);
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      status: "cancelled",
      idempotencyKey: null,
      idempotencyFingerprint: fingerprintFor(),
    });

    const retry = await postOrder();
    const retryBody = await retry.json();

    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBeNull();
    expect(retryBody).toMatchObject({
      order_number: "ZF-TEST-2",
      client_secret: "secret_retry",
      total_cents: 1000,
    });
    expect(state.orders).toHaveLength(2);
    expect(state.orders[1]).toMatchObject({
      status: "pending",
      idempotencyKey: KEY,
      stripePaymentIntentId: "pi_retry",
    });
    expect(mock.createPaymentIntent).toHaveBeenCalledTimes(2);
  });

  it("scopes keys per customer and never replays another customer's order", async () => {
    state.orders.push(orderRow());
    mock.customerId = CUSTOMER_B;

    const response = await postOrder();
    const responseBody = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
    expect(responseBody.order_number).toBe("ZF-TEST-1");
    expect(responseBody.order_number).not.toBe("ZF-TEST-9001");
    expect(responseBody.client_secret).toBe("secret_created");
    expect(state.orders).toHaveLength(2);
    expect(state.orders[0].customerId).toBe(CUSTOMER_A);
    expect(state.orders[1].customerId).toBe(CUSTOMER_B);
    expect(mock.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mock.retrievePaymentIntent).not.toHaveBeenCalled();
  });
});
