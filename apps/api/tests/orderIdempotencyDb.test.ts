import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  customers,
  deliveries,
  deliveryZones,
  orderItems,
  orders,
  products,
} from "../src/db/schema";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_SSL = "disable";
  process.env.APP_ENV = "development";
  process.env.NODE_ENV = "test";
}

const mock = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
}));

vi.mock("../src/lib/customerAuth", () => ({
  requireCustomer: (
    req: {
      get?: (name: string) => string | undefined;
      customer?: unknown;
    },
    _res: unknown,
    next: () => void,
  ) => {
    req.customer = { id: req.get?.("x-test-customer-id") };
    next();
  },
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

const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;
const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let server: Server | null = null;
let baseUrl = "";
let client: ReturnType<typeof postgres> | null = null;
let database: ReturnType<typeof drizzle> | null = null;
let customerId = "";
let productId = "";
let zoneId = "";

beforeAll(async () => {
  if (!TEST_DATABASE_URL) {
    return;
  }

  const { ordersRouter } = await import("../src/routes/orders");

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api", ordersRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server!.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  client = postgres(TEST_DATABASE_URL, {
    max: 5,
    prepare: false,
    onnotice: () => {},
  });
  database = drizzle(client);

  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const [customer] = await database
    .insert(customers)
    .values({
      phone: `+1212555${String(Math.floor(Math.random() * 9000) + 1000)}`,
      name: "Idempotency Test",
    })
    .returning({ id: customers.id });
  customerId = customer.id;

  const [product] = await database
    .insert(products)
    .values({
      name: `Idempotency Chair ${suffix}`,
      slug: `idempotency-chair-${suffix}`,
      sku: `IDEM-${suffix}`,
      priceCents: 1000,
      stockQty: 50,
      status: "active",
    })
    .returning({ id: products.id });
  productId = product.id;

  const [zone] = await database
    .insert(deliveryZones)
    .values({
      name: `Idempotency zone ${suffix}`,
      zipStart: "11201",
      zipEnd: "11201",
      feeCents: 0,
      freeOverCents: null,
      isActive: true,
    })
    .returning({ id: deliveryZones.id });
  zoneId = zone.id;
});

afterAll(async () => {
  if (database && client) {
    if (customerId) {
      const orderRows = await database
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.customerId, customerId));

      if (orderRows.length > 0) {
        await database.delete(orders).where(
          inArray(
            orders.id,
            orderRows.map((row) => row.id),
          ),
        );
      }
    }

    if (productId) {
      await database.delete(products).where(eq(products.id, productId));
    }
    if (zoneId) {
      await database.delete(deliveryZones).where(eq(deliveryZones.id, zoneId));
    }
    if (customerId) {
      await database.delete(customers).where(eq(customers.id, customerId));
    }
  }

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  if (client) {
    await client.end();
  }

  const { connection } = await import("../src/db/client");
  await connection?.end();

  mock.createPaymentIntent.mockReset();
  mock.retrievePaymentIntent.mockReset();
});

describeWithDatabase("order idempotency database behavior", () => {
  it(
    "creates one order, one item set, one delivery and one PaymentIntent for five concurrent identical requests",
    async () => {
      if (!database || !client) {
        throw new Error("Test database is not configured.");
      }

      let sequence = 0;
      mock.createPaymentIntent.mockImplementation(async () => {
        sequence += 1;
        return {
          id: `pi_concurrent_${sequence}`,
          client_secret: `secret_concurrent_${sequence}`,
        };
      });
      mock.retrievePaymentIntent.mockImplementation(
        async (paymentIntentId: string) => ({
          id: paymentIntentId,
          client_secret: `secret_${paymentIntentId}`,
        }),
      );

      const indexRows = await client.unsafe<{ indexname: string }[]>(
        `select indexname from pg_indexes
          where schemaname = 'public'
            and tablename = 'orders'
            and indexname = 'orders_customer_id_idempotency_key_unique'`,
      );
      expect(indexRows).toHaveLength(1);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${baseUrl}/api/orders`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": KEY,
              "x-test-customer-id": customerId,
            },
            body: JSON.stringify({
              items: [{ product_id: productId, quantity: 1 }],
              zip: "11201",
              email: "idempotency@example.com",
              shipping_address: {
                name: "Idempotency Test",
                line1: "1 Main St",
                city: "Brooklyn",
                state: "NY",
                zip: "11201",
              },
            }),
          }),
        ),
      );
      const bodies = await Promise.all(
        responses.map((response) => response.json()),
      );
      const created = responses.filter((response) => response.status === 201);
      const replayed = responses.filter((response) => response.status === 200);

      expect(created).toHaveLength(1);
      expect(replayed).toHaveLength(4);
      expect(
        replayed.every(
          (response) =>
            response.headers.get("idempotent-replayed") === "true",
        ),
      ).toBe(true);
      expect(new Set(bodies.map((body) => body.order_number)).size).toBe(1);
      expect(mock.createPaymentIntent).toHaveBeenCalledTimes(1);

      const orderRows = await database
        .select()
        .from(orders)
        .where(eq(orders.customerId, customerId));
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]).toMatchObject({
        status: "pending",
        idempotencyKey: KEY,
      });

      const [itemCount] = await database
        .select({ value: sql<number>`count(*)` })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderRows[0].id));
      const [deliveryCount] = await database
        .select({ value: sql<number>`count(*)` })
        .from(deliveries)
        .where(eq(deliveries.orderId, orderRows[0].id));

      expect(Number(itemCount?.value ?? 0)).toBe(1);
      expect(Number(deliveryCount?.value ?? 0)).toBe(1);
    },
    120_000,
  );
});
