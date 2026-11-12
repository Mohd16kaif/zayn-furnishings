import {
  markOrderPaid,
  type MarkOrderPaidResult,
} from "./markOrderPaid";
import { stripe } from "./stripe";

export const RECONCILE_MIN_ORDER_AGE_MS = 20_000;
export const RECONCILE_LOOKUP_INTERVAL_MS = 10_000;
export const RECONCILE_STRIPE_TIMEOUT_MS = 5_000;

export type ReconcileOrderInput = {
  id: string;
  orderNumber: string;
  totalCents: number;
  stripePaymentIntentId: string | null;
  createdAt: Date;
};

export type ReconcileOrderResult =
  | { status: "reconciled"; result: MarkOrderPaidResult; paymentIntentStatus: string }
  | { status: "dry_run_would_mark"; paymentIntentStatus: string }
  | { status: "skipped_too_new" }
  | { status: "skipped_recent_lookup" }
  | { status: "skipped_missing_intent" }
  | { status: "payment_not_succeeded"; paymentIntentStatus: string }
  | { status: "amount_mismatch"; paymentIntentStatus: string; amountReceivedCents: number }
  | { status: "stripe_failed"; error: string };

const lastLookupAt = new Map<string, number>();

function claimLookup(orderId: string): boolean {
  const now = Date.now();
  const last = lastLookupAt.get(orderId);

  if (last !== undefined && now - last < RECONCILE_LOOKUP_INTERVAL_MS) {
    return false;
  }

  if (lastLookupAt.size > 1000) {
    for (const [key, value] of lastLookupAt) {
      if (now - value >= RECONCILE_LOOKUP_INTERVAL_MS) {
        lastLookupAt.delete(key);
      }
    }
  }

  lastLookupAt.set(orderId, now);
  return true;
}

/**
 * Safe server-only payment reconciliation for one order. Stripe is only
 * consulted for a pending order; the order total is always compared in
 * integer cents before markOrderPaid can transition it.
 */
export async function reconcileOrderPayment(
  order: ReconcileOrderInput,
  options: {
    enforceAge?: boolean;
    enforceLookupLimit?: boolean;
    dryRun?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<ReconcileOrderResult> {
  const {
    enforceAge = true,
    enforceLookupLimit = true,
    dryRun = false,
    timeoutMs = RECONCILE_STRIPE_TIMEOUT_MS,
  } = options;

  if (!order.stripePaymentIntentId) {
    return { status: "skipped_missing_intent" };
  }

  if (
    enforceAge &&
    Date.now() - order.createdAt.getTime() < RECONCILE_MIN_ORDER_AGE_MS
  ) {
    return { status: "skipped_too_new" };
  }

  if (enforceLookupLimit && !claimLookup(order.id)) {
    return { status: "skipped_recent_lookup" };
  }

  if (!stripe) {
    return { status: "stripe_failed", error: "Stripe is not configured." };
  }

  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.retrieve(
      order.stripePaymentIntentId,
      {},
      { timeout: timeoutMs },
    );
  } catch (error) {
    return {
      status: "stripe_failed",
      error: error instanceof Error ? error.message : "Stripe request failed.",
    };
  }

  if (paymentIntent.status !== "succeeded") {
    return {
      status: "payment_not_succeeded",
      paymentIntentStatus: paymentIntent.status,
    };
  }

  if (paymentIntent.amount_received !== order.totalCents) {
    return {
      status: "amount_mismatch",
      paymentIntentStatus: paymentIntent.status,
      amountReceivedCents: paymentIntent.amount_received,
    };
  }

  if (dryRun) {
    return {
      status: "dry_run_would_mark",
      paymentIntentStatus: paymentIntent.status,
    };
  }

  const result = await markOrderPaid({
    paymentIntentId: paymentIntent.id,
    amountReceivedCents: paymentIntent.amount_received,
    currency: paymentIntent.currency,
  });

  return {
    status: "reconciled",
    result,
    paymentIntentStatus: paymentIntent.status,
  };
}
