import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders } from "../db/schema";
import { readStoreSettings } from "../lib/storeSettings";
import {
  ORDER_CONFIRMATION_TEMPLATE,
  OWNER_NEW_ORDER_TEMPLATE,
  dispatchNotification,
  enqueueNotification,
  truncateError,
} from "./outbox";

export type OrderPaidEmailResult = {
  customerEnqueued: boolean;
  ownerEnqueued: boolean;
  dispatched: number;
};

export async function queueAndDispatchOrderPaidEmails(
  orderId: string,
): Promise<OrderPaidEmailResult> {
  const empty = {
    customerEnqueued: false,
    ownerEnqueued: false,
    dispatched: 0,
  };

  if (!db) {
    return empty;
  }

  const [order] = await db
    .select({ id: orders.id, email: orders.email })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return empty;
  }

  const settings = await readStoreSettings(db);
  const storeEmail = settings.email.trim();
  const pendingDispatch: string[] = [];

  const customer = await enqueueNotification({
    template: ORDER_CONFIRMATION_TEMPLATE,
    orderId,
    toAddress: order.email.trim(),
    dedupeKey: `order_confirmation:${orderId}`,
  });

  if (customer.inserted && customer.id) {
    pendingDispatch.push(customer.id);
  }

  let ownerEnqueued = false;

  if (storeEmail) {
    const owner = await enqueueNotification({
      template: OWNER_NEW_ORDER_TEMPLATE,
      orderId,
      toAddress: storeEmail,
      dedupeKey: `owner_new_order:${orderId}`,
    });

    ownerEnqueued = owner.inserted;

    if (owner.inserted && owner.id) {
      pendingDispatch.push(owner.id);
    }
  }

  for (const id of pendingDispatch) {
    await dispatchNotification(id);
  }

  return {
    customerEnqueued: customer.inserted,
    ownerEnqueued,
    dispatched: pendingDispatch.length,
  };
}

export function scheduleOrderPaidEmails(orderId: string): void {
  setImmediate(() => {
    void queueAndDispatchOrderPaidEmails(orderId).catch((error) => {
      console.error(
        "Order email notification failed:",
        truncateError(
          error instanceof Error ? error.message : "Unknown email error.",
        ),
      );
    });
  });
}
