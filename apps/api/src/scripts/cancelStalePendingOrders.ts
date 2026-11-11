import { and, eq, lt } from "drizzle-orm";
import { connection, db } from "../db/client";
import { auditLog, orders } from "../db/schema";
import { stripe } from "../lib/stripe";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const staleOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      stripePaymentIntentId: orders.stripePaymentIntentId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        lt(orders.createdAt, cutoff),
      ),
    );

  if (staleOrders.length === 0) {
    console.log("No stale pending orders found.");
    return;
  }

  for (const order of staleOrders) {
    let paymentIntentCancelled = false;
    let paymentIntentError: string | null = null;
    let paymentAlreadySucceeded = false;

    if (order.stripePaymentIntentId) {
      if (!stripe) {
        console.log(
          `Stripe key missing; skipping PaymentIntent cancellation for ${order.orderNumber}.`,
        );
      } else if (dryRun) {
        console.log(
          `[dry-run] Would cancel PaymentIntent for ${order.orderNumber}.`,
        );
      } else {
        try {
          const intent = await stripe.paymentIntents.retrieve(
            order.stripePaymentIntentId,
          );

          if (intent.status === "succeeded") {
            paymentAlreadySucceeded = true;
            paymentIntentError =
              "PaymentIntent already succeeded; order left for manual review.";
            console.warn(
              `Skipping ${order.orderNumber}: PaymentIntent already succeeded.`,
            );
          } else if (intent.status === "canceled") {
            paymentIntentCancelled = true;
          } else {
            const cancelled = await stripe.paymentIntents.cancel(
              order.stripePaymentIntentId,
            );
            paymentIntentCancelled = cancelled.status === "canceled";
          }
        } catch (error) {
          paymentIntentError =
            error instanceof Error ? error.message : "Unknown Stripe error";
          console.error(
            `PaymentIntent cancellation failed for ${order.orderNumber}: ${paymentIntentError}`,
          );
        }
      }
    }

    if (paymentAlreadySucceeded) {
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] Would cancel order ${order.orderNumber}.`);
      continue;
    }

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(orders.id, order.id), eq(orders.status, "pending")),
        )
        .returning({ id: orders.id });

      if (updated.length === 0) {
        return;
      }

      await tx.insert(auditLog).values({
        action: "order.stale_pending_cancelled",
        entity: "order",
        entityId: order.id,
        details: {
          order_number: order.orderNumber,
          payment_intent_id: order.stripePaymentIntentId,
          payment_intent_cancelled: paymentIntentCancelled,
          payment_intent_error: paymentIntentError,
        },
      });
    });

    console.log(`Cancelled stale order ${order.orderNumber}.`);
  }

  console.log(
    `Processed ${staleOrders.length} stale pending order(s)${
      dryRun ? " (dry run)" : ""
    }.`,
  );
}

main()
  .catch((error) => {
    console.error(
      "Stale order cancellation failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
