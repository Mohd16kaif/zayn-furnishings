import { eq } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { env } from "../config/env";
import { db } from "../db/client";
import { orders, payments } from "../db/schema";
import { markOrderPaid } from "../lib/markOrderPaid";
import {
  applyRefundState,
  type RefundLedgerEntry,
} from "../lib/refundLedger";
import { stripe } from "../lib/stripe";

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

function refundsFromCharge(charge: Stripe.Charge): RefundLedgerEntry[] {
  return (charge.refunds?.data ?? [])
    .filter(
      (refund) => refund.status !== "failed" && refund.status !== "canceled",
    )
    .map((refund) => ({
      id: refund.id,
      amountCents: refund.amount,
      createdAt: new Date(refund.created * 1000),
    }));
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
        const result = await markOrderPaid({
          paymentIntentId: paymentIntent.id,
          amountReceivedCents: paymentIntent.amount_received,
          currency: paymentIntent.currency,
        });

        if (result.status === "order_not_found") {
          console.warn(
            `Stripe webhook: no order for payment intent ${paymentIntent.id}`,
          );
        } else if (result.status === "amount_mismatch") {
          console.error(
            `Stripe webhook: amount mismatch for order ${result.orderNumber} (payment intent ${paymentIntent.id})`,
          );
        }

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

        const ledger = await db.transaction(async (tx) =>
          applyRefundState(tx, {
            orderId: order.id,
            refunds: refundsFromCharge(charge),
            stripeAmountRefundedCents: charge.amount_refunded,
            fallbackRawEventId: event.id,
            fallbackCreatedAt: new Date(event.created * 1000),
          }),
        );

        if (ledger.ledgerMismatch) {
          console.warn(
            `Stripe webhook: refund ledger exceeds Stripe amount for order ${order.orderNumber}`,
          );
        }

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
