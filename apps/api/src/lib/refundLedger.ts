import type { OrderStatus } from "@zayn/shared";
import { eq } from "drizzle-orm";
import type { Executor } from "./adminCatalog";
import { deliveries, orders, payments } from "../db/schema";

export const REFUND_RAW_EVENT_PREFIX = "refund:";
export const REFUND_EVENT_RAW_EVENT_PREFIX = "refund_event:";

export const REFUNDABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "partially_refunded",
]);

export type RefundLedgerEntry = {
  id: string;
  amountCents: number;
  createdAt?: Date;
};

export type RefundSummaryPayment = {
  status: string;
  amountCents: number;
};

export type RefundSummary = {
  paidAmountCents: number;
  totalRefundedCents: number;
  refundableRemainingCents: number;
};

export function refundRawEventId(refundId: string): string {
  return `${REFUND_RAW_EVENT_PREFIX}${refundId}`;
}

export function refundEventRawEventId(eventId: string): string {
  return `${REFUND_EVENT_RAW_EVENT_PREFIX}${eventId}`;
}

export function refundIdFromRawEventId(
  rawEventId: string | null | undefined,
): string | null {
  if (!rawEventId || !rawEventId.startsWith(REFUND_RAW_EVENT_PREFIX)) {
    return null;
  }

  const refundId = rawEventId.slice(REFUND_RAW_EVENT_PREFIX.length);

  return refundId || null;
}

export function summarizeRefunds(
  paymentRows: RefundSummaryPayment[],
  fallbackPaidCents: number,
): RefundSummary {
  let succeededCents = 0;
  let refundedCents = 0;

  for (const row of paymentRows) {
    if (row.status === "succeeded") {
      succeededCents += row.amountCents;
    } else if (row.status === "refunded") {
      refundedCents += row.amountCents;
    }
  }

  const paidAmountCents =
    succeededCents > 0 ? succeededCents : Math.max(0, fallbackPaidCents);

  return {
    paidAmountCents,
    totalRefundedCents: refundedCents,
    refundableRemainingCents: Math.max(0, paidAmountCents - refundedCents),
  };
}

export function deriveRefundOrderStatus(
  totalRefundedCents: number,
  paidAmountCents: number,
): "refunded" | "partially_refunded" | null {
  if (totalRefundedCents <= 0) {
    return null;
  }

  if (paidAmountCents <= 0 || totalRefundedCents >= paidAmountCents) {
    return "refunded";
  }

  return "partially_refunded";
}

export type RefundValidationInput = {
  orderStatus: OrderStatus;
  hasSucceededStripePayment: boolean;
  paidAmountCents: number;
  totalRefundedCents: number;
  amountCents?: number | null;
  restock: boolean;
};

export type RefundValidationResult =
  | { ok: true; amountCents: number }
  | { ok: false; status: number; message: string };

function formatCentsForMessage(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export function validateRefundRequest(
  input: RefundValidationInput,
): RefundValidationResult {
  if (!REFUNDABLE_ORDER_STATUSES.has(input.orderStatus)) {
    return {
      ok: false,
      status: 409,
      message: "This order cannot be refunded.",
    };
  }

  if (!input.hasSucceededStripePayment) {
    return {
      ok: false,
      status: 409,
      message: "This order has no captured Stripe payment to refund.",
    };
  }

  const remainingCents = Math.max(
    0,
    input.paidAmountCents - input.totalRefundedCents,
  );

  if (remainingCents <= 0) {
    return {
      ok: false,
      status: 409,
      message: "This order has already been fully refunded.",
    };
  }

  const amountCents = input.amountCents ?? remainingCents;

  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return {
      ok: false,
      status: 400,
      message: "Enter a refund amount of at least $0.01.",
    };
  }

  if (amountCents > remainingCents) {
    return {
      ok: false,
      status: 400,
      message: `The refund amount cannot be more than the ${formatCentsForMessage(
        remainingCents,
      )} still refundable.`,
    };
  }

  if (input.restock && amountCents !== remainingCents) {
    return {
      ok: false,
      status: 400,
      message:
        "Items can only be put back in stock when the whole order is being refunded.",
    };
  }

  return { ok: true, amountCents };
}

export type ApplyRefundStateInput = {
  orderId: string;
  refunds?: RefundLedgerEntry[];
  stripeAmountRefundedCents?: number;
  fallbackRawEventId?: string;
  fallbackCreatedAt?: Date;
};

export type ApplyRefundStateResult = {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  paidAmountCents: number;
  totalRefundedCents: number;
  refundableRemainingCents: number;
  fullyRefunded: boolean;
  insertedRawEventIds: string[];
  deliveryStatus: string | null;
  deliveryCancelled: boolean;
  ledgerMismatch: boolean;
};

export async function applyRefundState(
  executor: Executor,
  input: ApplyRefundStateInput,
): Promise<ApplyRefundStateResult> {
  const [order] = await executor
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1)
    .for("update");

  if (!order) {
    throw new Error("Order not found for refund ledger update.");
  }

  const paymentRows = await executor
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id));
  const summary = summarizeRefunds(paymentRows, order.totalCents);
  const existingKeys = new Set(
    paymentRows
      .map((row) => row.rawEventId)
      .filter((value): value is string => Boolean(value)),
  );
  const succeededPayment = paymentRows.find(
    (row) => row.status === "succeeded",
  );
  const currency = succeededPayment?.currency ?? "usd";
  const targetAmountCents =
    typeof input.stripeAmountRefundedCents === "number" &&
    Number.isInteger(input.stripeAmountRefundedCents)
      ? Math.max(0, input.stripeAmountRefundedCents)
      : null;

  let totalRefundedCents = summary.totalRefundedCents;
  const insertedRawEventIds: string[] = [];

  for (const refund of input.refunds ?? []) {
    if (!Number.isInteger(refund.amountCents) || refund.amountCents < 1) {
      continue;
    }

    const rawEventId = refundRawEventId(refund.id);

    if (existingKeys.has(rawEventId)) {
      continue;
    }

    if (
      targetAmountCents !== null &&
      totalRefundedCents + refund.amountCents > targetAmountCents
    ) {
      continue;
    }

    const inserted = await executor
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "stripe",
        providerPaymentId: refund.id,
        amountCents: refund.amountCents,
        currency,
        status: "refunded",
        rawEventId,
        ...(refund.createdAt ? { createdAt: refund.createdAt } : {}),
      })
      .onConflictDoNothing({ target: payments.rawEventId })
      .returning({ id: payments.id });

    if (inserted.length > 0) {
      existingKeys.add(rawEventId);
      insertedRawEventIds.push(rawEventId);
      totalRefundedCents += refund.amountCents;
    }
  }

  if (
    targetAmountCents !== null &&
    targetAmountCents > totalRefundedCents &&
    input.fallbackRawEventId
  ) {
    const rawEventId = refundEventRawEventId(input.fallbackRawEventId);

    if (!existingKeys.has(rawEventId)) {
      const differenceCents = targetAmountCents - totalRefundedCents;
      const inserted = await executor
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "stripe",
          providerPaymentId: null,
          amountCents: differenceCents,
          currency,
          status: "refunded",
          rawEventId,
          ...(input.fallbackCreatedAt
            ? { createdAt: input.fallbackCreatedAt }
            : {}),
        })
        .onConflictDoNothing({ target: payments.rawEventId })
        .returning({ id: payments.id });

      if (inserted.length > 0) {
        existingKeys.add(rawEventId);
        insertedRawEventIds.push(rawEventId);
        totalRefundedCents += differenceCents;
      }
    }
  }

  const nextStatus = deriveRefundOrderStatus(
    totalRefundedCents,
    summary.paidAmountCents,
  );
  const now = new Date();
  let orderStatus = order.status;

  if (nextStatus !== null && nextStatus !== order.status) {
    await executor
      .update(orders)
      .set({ status: nextStatus, updatedAt: now })
      .where(eq(orders.id, order.id));
    orderStatus = nextStatus;
  }

  let deliveryStatus: string | null = null;
  let deliveryCancelled = false;

  if (nextStatus === "refunded") {
    const [delivery] = await executor
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, order.id))
      .limit(1)
      .for("update");

    if (delivery) {
      deliveryStatus = delivery.status;

      if (
        delivery.status !== "out_for_delivery" &&
        delivery.status !== "delivered" &&
        delivery.status !== "cancelled"
      ) {
        await executor
          .update(deliveries)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(deliveries.id, delivery.id));
        deliveryStatus = "cancelled";
        deliveryCancelled = true;
      }
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderStatus,
    paidAmountCents: summary.paidAmountCents,
    totalRefundedCents,
    refundableRemainingCents: Math.max(
      0,
      summary.paidAmountCents - totalRefundedCents,
    ),
    fullyRefunded: orderStatus === "refunded",
    insertedRawEventIds,
    deliveryStatus,
    deliveryCancelled,
    ledgerMismatch:
      targetAmountCents !== null && totalRefundedCents > targetAmountCents,
  };
}
