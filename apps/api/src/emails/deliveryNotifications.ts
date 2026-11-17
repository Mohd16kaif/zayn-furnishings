import type { DeliveryEmailTemplate } from "@zayn/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { orders } from "../db/schema";
import {
  DELIVERY_SCHEDULED_TEMPLATE,
  DELIVERED_TEMPLATE,
  OUT_FOR_DELIVERY_TEMPLATE,
  dispatchNotification,
  enqueueNotification,
  logSkippedNoEmail,
  truncateError,
} from "./outbox";

export type DeliveryEmailEvent = {
  template: DeliveryEmailTemplate;
  dedupeKey: string;
};

export type DeliveryEmailInput = {
  orderId: string;
  orderNumber: string;
  events: DeliveryEmailTemplate[];
  scheduledDate: string | null;
  timeWindow: string | null;
};

export function deliveryEmailDedupeKey(
  template: DeliveryEmailTemplate,
  orderId: string,
  scheduledDate: string | null,
  timeWindow: string | null,
): string {
  if (template === DELIVERY_SCHEDULED_TEMPLATE) {
    return `${DELIVERY_SCHEDULED_TEMPLATE}:${orderId}:${
      scheduledDate ?? ""
    }:${timeWindow ?? ""}`;
  }

  if (template === OUT_FOR_DELIVERY_TEMPLATE) {
    return `${OUT_FOR_DELIVERY_TEMPLATE}:${orderId}`;
  }

  return `${DELIVERED_TEMPLATE}:${orderId}`;
}

export function deliveryEmailEventsWithKeys(
  input: DeliveryEmailInput,
): DeliveryEmailEvent[] {
  return input.events.map((template) => ({
    template,
    dedupeKey: deliveryEmailDedupeKey(
      template,
      input.orderId,
      input.scheduledDate,
      input.timeWindow,
    ),
  }));
}

export async function queueDeliveryEmails(
  input: DeliveryEmailInput,
): Promise<number> {
  if (!db || input.events.length === 0) {
    return 0;
  }

  const [order] = await db
    .select({ id: orders.id, email: orders.email })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) {
    return 0;
  }

  const toAddress = order.email.trim();

  if (!toAddress) {
    logSkippedNoEmail(input.orderNumber);
    return 0;
  }

  let dispatched = 0;

  for (const event of deliveryEmailEventsWithKeys(input)) {
    const enqueued = await enqueueNotification({
      template: event.template,
      orderId: input.orderId,
      toAddress,
      dedupeKey: event.dedupeKey,
    });

    if (!enqueued.inserted || !enqueued.id) {
      continue;
    }

    await dispatchNotification(enqueued.id);
    dispatched += 1;
  }

  return dispatched;
}

export function scheduleDeliveryEmails(input: DeliveryEmailInput): void {
  if (input.events.length === 0) {
    return;
  }

  try {
    setImmediate(() => {
      void queueDeliveryEmails(input).catch((error) => {
        console.error(
          "Delivery email notification failed:",
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
      "Delivery email scheduling failed:",
      truncateError(
        error instanceof Error ? error.message : "Unknown email error.",
      ),
    );
  }
}
