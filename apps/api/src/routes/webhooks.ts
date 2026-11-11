import { asc, eq, inArray, sql } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import {
  calculateStockDeduction,
  type StockDeduction,
} from "@zayn/shared";
import Stripe from "stripe";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  auditLog,
  discountCodes,
  orderItems,
  orders,
  payments,
  products,
  stockMovements,
} from "../db/schema";
import { stripe } from "../lib/stripe";

type Shortage = StockDeduction & {
  productId: string | null;
  name: string;
};

function sendReceived(res: Response): void {
  res.status(200).json({ received: true });
}

function paymentIntentIdFromCharge(charge: Stripe.Charge): string | null {
  const value = charge.payment_intent;

  if (typeof value === "string") {
    return value;
  }

  return value?.id ?? null;
}

async function findOrderByPaymentIntentId(paymentIntentId: string) {
  if (!db) {
    return null;
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripePaymentIntentId, paymentIntentId))
    .limit(1);

  return order ?? null;
}

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  "/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Stripe webhook is not configured." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const signature = req.get("stripe-signature");
    const rawBody = req.body;

    if (!signature || !Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: "Invalid Stripe webhook payload." });
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      console.error(
        "Stripe webhook signature verification failed:",
        error instanceof Error ? error.message : error,
      );
      res.status(400).json({ error: "Invalid Stripe webhook signature." });
      return;
    }

    try {
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const order = await findOrderByPaymentIntentId(paymentIntent.id);

        if (!order) {
          console.warn(
            `Stripe webhook: no order for payment intent ${paymentIntent.id}`,
          );
          sendReceived(res);
          return;
        }

        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(payments)
            .values({
              orderId: order.id,
              provider: "stripe",
              providerPaymentId: paymentIntent.id,
              amountCents: paymentIntent.amount_received,
              currency: paymentIntent.currency,
              status: "succeeded",
              rawEventId: event.id,
            })
            .onConflictDoNothing({ target: payments.rawEventId })
            .returning({ id: payments.id });

          if (inserted.length === 0) {
            return;
          }

          const [lockedOrder] = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, order.id))
            .for("update");

          if (!lockedOrder || lockedOrder.status !== "pending") {
            return;
          }

          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id));
          const itemProductIds = Array.from(
            new Set(
              items
                .map((item) => item.productId)
                .filter((id): id is string => Boolean(id)),
            ),
          ).sort();

          const lockedProducts =
            itemProductIds.length > 0
              ? await tx
                  .select()
                  .from(products)
                  .where(inArray(products.id, itemProductIds))
                  .orderBy(asc(products.id))
                  .for("update")
              : [];
          const productsById = new Map(
            lockedProducts.map((product) => [product.id, product]),
          );
          const shortages: Shortage[] = [];

          for (const item of items) {
            const product = item.productId
              ? productsById.get(item.productId)
              : undefined;

            if (!product) {
              shortages.push({
                productId: item.productId,
                name: item.nameSnapshot,
                requestedQty: item.quantity,
                availableQty: 0,
                appliedQty: 0,
                shortfallQty: item.quantity,
                remainingQty: 0,
              });
              continue;
            }

            const deduction = calculateStockDeduction(
              item.quantity,
              product.stockQty,
            );

            if (deduction.appliedQty > 0) {
              await tx
                .update(products)
                .set({
                  stockQty: deduction.remainingQty,
                  updatedAt: new Date(),
                })
                .where(eq(products.id, product.id));
            }

            await tx.insert(stockMovements).values({
              productId: product.id,
              change: -deduction.appliedQty,
              reason: "order_paid",
              orderId: order.id,
              note:
                deduction.shortfallQty > 0
                  ? `Short by ${deduction.shortfallQty} (requested ${deduction.requestedQty}, available ${deduction.availableQty})`
                  : null,
            });

            if (deduction.shortfallQty > 0) {
              shortages.push({
                ...deduction,
                productId: product.id,
                name: item.nameSnapshot,
              });
            }
          }

          const now = new Date();

          if (shortages.length > 0) {
            const note = `STOCK SHORTAGE: needs manual review (${shortages
              .map(
                (shortage) =>
                  `${shortage.name}: requested ${shortage.requestedQty}, available ${shortage.availableQty}`,
              )
              .join("; ")})`;

            await tx
              .update(orders)
              .set({
                status: "processing",
                paidAt: now,
                internalNotes: lockedOrder.internalNotes
                  ? `${lockedOrder.internalNotes}\n${note}`
                  : note,
                updatedAt: now,
              })
              .where(eq(orders.id, order.id));

            await tx.insert(auditLog).values({
              action: "order.stock_shortage",
              entity: "order",
              entityId: order.id,
              details: {
                order_number: lockedOrder.orderNumber,
                shortfalls: shortages.map((shortage) => ({
                  product_id: shortage.productId,
                  name: shortage.name,
                  requested_qty: shortage.requestedQty,
                  available_qty: shortage.availableQty,
                  shortfall_qty: shortage.shortfallQty,
                })),
              },
            });
          } else {
            await tx
              .update(orders)
              .set({
                status: "paid",
                paidAt: now,
                updatedAt: now,
              })
              .where(eq(orders.id, order.id));
          }

          if (lockedOrder.discountCode) {
            await tx
              .update(discountCodes)
              .set({
                usedCount: sql`${discountCodes.usedCount} + 1`,
                updatedAt: now,
              })
              .where(eq(discountCodes.code, lockedOrder.discountCode));
          }
        });

        sendReceived(res);
        return;
      }

      if (event.type === "payment_intent.payment_failed") {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const order = await findOrderByPaymentIntentId(paymentIntent.id);

        if (!order) {
          console.warn(
            `Stripe webhook: no order for failed payment intent ${paymentIntent.id}`,
          );
          sendReceived(res);
          return;
        }

        await db
          .insert(payments)
          .values({
            orderId: order.id,
            provider: "stripe",
            providerPaymentId: paymentIntent.id,
            amountCents: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: "failed",
            rawEventId: event.id,
          })
          .onConflictDoNothing({ target: payments.rawEventId });

        sendReceived(res);
        return;
      }

      if (event.type === "charge.refunded") {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = paymentIntentIdFromCharge(charge);

        if (!paymentIntentId) {
          sendReceived(res);
          return;
        }

        const order = await findOrderByPaymentIntentId(paymentIntentId);

        if (!order) {
          console.warn(
            `Stripe webhook: no order for refunded payment intent ${paymentIntentId}`,
          );
          sendReceived(res);
          return;
        }

        const refundedAmountCents = charge.amount_refunded;

        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(payments)
            .values({
              orderId: order.id,
              provider: "stripe",
              providerPaymentId: paymentIntentId,
              amountCents: refundedAmountCents,
              currency: charge.currency,
              status: "refunded",
              rawEventId: event.id,
            })
            .onConflictDoNothing({ target: payments.rawEventId })
            .returning({ id: payments.id });

          if (inserted.length === 0) {
            return;
          }

          await tx
            .update(orders)
            .set({
              status:
                refundedAmountCents >= order.totalCents
                  ? "refunded"
                  : "partially_refunded",
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));
        });

        sendReceived(res);
        return;
      }

      sendReceived(res);
    } catch (error) {
      console.error(
        `Stripe webhook processing failed for ${event.type}:`,
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ error: "Stripe webhook processing failed." });
    }
  },
);
