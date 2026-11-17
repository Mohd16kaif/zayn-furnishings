import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders } from "../db/schema";
import {
  REFUND_ISSUED_TEMPLATE,
  dispatchNotification,
  enqueueNotification,
  logSkippedNoEmail,
  truncateError,
} from "./outbox";

export function refundEmailDedupeKey(refundRowKey: string): string {
  return `${REFUND_ISSUED_TEMPLATE}:${refundRowKey}`;
}

export async function queueRefundIssuedEmails(
  orderId: string,
  refundRowKeys: string[],
): Promise<number> {
  if (!db || refundRowKeys.length === 0) {
    return 0;
  }

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return 0;
  }

  const toAddress = order.email.trim();

  if (!toAddress) {
    logSkippedNoEmail(order.orderNumber);
    return 0;
  }

  let dispatched = 0;

  for (const refundRowKey of refundRowKeys) {
    const enqueued = await enqueueNotification({
      template: REFUND_ISSUED_TEMPLATE,
      orderId,
      toAddress,
      dedupeKey: refundEmailDedupeKey(refundRowKey),
    });

    if (!enqueued.inserted || !enqueued.id) {
      continue;
    }

    await dispatchNotification(enqueued.id);
    dispatched += 1;
  }

  return dispatched;
}

export function scheduleRefundIssuedEmails(
  orderId: string,
  refundRowKeys: string[],
): void {
  if (refundRowKeys.length === 0) {
    return;
  }

  try {
    setImmediate(() => {
      void queueRefundIssuedEmails(orderId, refundRowKeys).catch((error) => {
        console.error(
          "Refund email notification failed:",
          truncateError(
            error instanceof Error
              ? error.message
              : "Unknown email error.",
          ),
        );
      });
    });
  } catch (error) {
    console.error(
      "Refund email scheduling failed:",
      truncateError(
        error instanceof Error ? error.message : "Unknown email error.",
      ),
    );
  }
}
