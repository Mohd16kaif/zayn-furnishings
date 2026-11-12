import { and, eq, inArray, or, sql } from "drizzle-orm";
import { normalizeUsPhone } from "@zayn/shared";
import { env } from "../config/env";
import { connection, db } from "../db/client";
import {
  customers,
  orders,
  phoneVerificationAttempts,
  products,
  stockMovements,
} from "../db/schema";
import { stripe } from "../lib/stripe";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function paymentIntentIdFromSecret(clientSecret: string): string {
  const id = clientSecret.split("_secret_")[0];

  if (!id?.startsWith("pi_")) {
    fail("Invalid client secret.");
  }

  return id;
}

async function commandStock(productId: string): Promise<void> {
  if (!db) {
    fail("DATABASE_URL is required.");
  }

  const [product] = await db
    .select({ id: products.id, stock: products.stockQty })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) {
    fail("Product not found.");
  }

  console.log(
    JSON.stringify({ product_id: product.id, stock: product.stock }),
  );
}

async function commandConfirm(clientSecret: string): Promise<void> {
  if (!stripe) {
    fail("STRIPE_SECRET_KEY is required.");
  }

  const id = paymentIntentIdFromSecret(clientSecret);
  const current = await stripe.paymentIntents.retrieve(id);

  if (current.status === "succeeded") {
    console.log(JSON.stringify({ ok: true, status: current.status }));
    return;
  }

  const confirmed = await stripe.paymentIntents.confirm(id, {
    payment_method: "pm_card_visa",
    return_url: `${env.WEB_ORIGIN}/account`,
  });

  console.log(
    JSON.stringify({
      ok: confirmed.status === "succeeded",
      status: confirmed.status,
    }),
  );

  if (confirmed.status !== "succeeded") {
    process.exitCode = 2;
  }
}

async function commandDecline(clientSecret: string): Promise<void> {
  if (!stripe) {
    fail("STRIPE_SECRET_KEY is required.");
  }

  const id = paymentIntentIdFromSecret(clientSecret);
  const current = await stripe.paymentIntents.retrieve(id);

  if (current.status === "canceled" || current.status === "succeeded") {
    console.log(JSON.stringify({ ok: true, status: current.status }));
    return;
  }

  try {
    const confirmed = await stripe.paymentIntents.confirm(id, {
      payment_method: "pm_card_chargeDeclined",
      return_url: `${env.WEB_ORIGIN}/account`,
    });

    console.log(
      JSON.stringify({ ok: false, status: confirmed.status }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: true,
        declined: true,
        message: error instanceof Error ? error.message : "declined",
      }),
    );
  }
}

async function commandWebhook(paymentIntentId: string): Promise<void> {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    fail("Stripe webhook configuration is required.");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
  );

  if (paymentIntent.status !== "succeeded") {
    fail(`PaymentIntent is ${paymentIntent.status}, not succeeded yet.`);
  }

  const payload = JSON.stringify({
    id: `evt_e2e_${Date.now()}_${paymentIntent.id}`,
    object: "event",
    api_version: "2025-03-31.basil",
    created: Math.floor(Date.now() / 1000),
    data: { object: paymentIntent },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "payment_intent.succeeded",
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  const response = await fetch(
    `http://localhost:${env.PORT}/webhooks/stripe`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    },
  );
  const body = await response.text();

  console.log(
    JSON.stringify({ ok: response.ok, status: response.status, body }),
  );

  if (!response.ok) {
    process.exitCode = 2;
  }
}

async function commandCleanup(
  phoneInput: string,
  orderNumbers: string[],
): Promise<void> {
  if (!db) {
    fail("DATABASE_URL is required.");
  }

  const phone = normalizeUsPhone(phoneInput);

  if (!phone) {
    fail("Invalid test phone.");
  }

  const result = await db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.phone, phone))
      .limit(1);
    const orderRows =
      customer && orderNumbers.length > 0
        ? await tx
            .select({ id: orders.id })
            .from(orders)
            .where(
              or(
                eq(orders.customerId, customer.id),
                inArray(orders.orderNumber, orderNumbers),
              ),
            )
        : customer
          ? await tx
              .select({ id: orders.id })
              .from(orders)
              .where(eq(orders.customerId, customer.id))
          : orderNumbers.length > 0
            ? await tx
                .select({ id: orders.id })
                .from(orders)
                .where(inArray(orders.orderNumber, orderNumbers))
            : [];
    const orderIds = orderRows.map((row) => row.id);
    let restored = 0;

    if (orderIds.length > 0) {
      const movements = await tx
        .select({
          productId: stockMovements.productId,
          change: stockMovements.change,
        })
        .from(stockMovements)
        .where(
          and(
            inArray(stockMovements.orderId, orderIds),
            eq(stockMovements.reason, "order_paid"),
          ),
        );
      const restoreByProduct = new Map<string, number>();

      for (const movement of movements) {
        if (movement.change >= 0) {
          continue;
        }

        restoreByProduct.set(
          movement.productId,
          (restoreByProduct.get(movement.productId) ?? 0) -
            movement.change,
        );
      }

      for (const [productId, quantity] of restoreByProduct) {
        await tx
          .update(products)
          .set({
            stockQty: sql`${products.stockQty} + ${quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(products.id, productId));

        restored += quantity;
      }

      await tx
        .delete(stockMovements)
        .where(inArray(stockMovements.orderId, orderIds));
      await tx.delete(orders).where(inArray(orders.id, orderIds));
    }

    await tx
      .delete(phoneVerificationAttempts)
      .where(eq(phoneVerificationAttempts.phone, phone));
    await tx.delete(customers).where(eq(customers.phone, phone));

    return { orders: orderIds.length, restored };
  });

  console.log(JSON.stringify({ ok: true, ...result }));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "stock":
      if (!args[0]) fail("Usage: stock <productId>");
      await commandStock(args[0]);
      break;
    case "confirm":
      if (!args[0]) fail("Usage: confirm <clientSecret>");
      await commandConfirm(args[0]);
      break;
    case "decline":
      if (!args[0]) fail("Usage: decline <clientSecret>");
      await commandDecline(args[0]);
      break;
    case "webhook":
      if (!args[0]) fail("Usage: webhook <paymentIntentId>");
      await commandWebhook(args[0]);
      break;
    case "cleanup": {
      const phone = args[0];
      const orderNumbers = (args[1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (!phone) {
        fail("Usage: cleanup <phone> [order1,order2]");
      }

      await commandCleanup(phone, orderNumbers);
      break;
    }
    default:
      fail(
        "Usage: e2eCheckoutHelper.ts <stock|confirm|decline|webhook|cleanup> ...",
      );
  }
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "E2E helper failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
