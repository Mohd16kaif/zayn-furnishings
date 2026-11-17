import { and, eq, inArray, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  deliveries,
  notificationsLog,
  orderItems,
  orders,
  payments,
  type NotificationLog,
} from "../db/schema";
import { readStoreSettings } from "../lib/storeSettings";
import { getEmailSender } from "./sender";
import {
  renderDelivered,
  renderDeliveryScheduled,
  renderOutForDelivery,
} from "./templates/deliveryUpdates";
import { renderOrderConfirmation } from "./templates/orderConfirmation";
import { renderOwnerNewOrder } from "./templates/ownerNewOrder";
import { renderRefundIssued } from "./templates/refundIssued";
import type { RenderedEmail } from "./templates/types";

export const ORDER_CONFIRMATION_TEMPLATE = "order_confirmation";
export const OWNER_NEW_ORDER_TEMPLATE = "owner_new_order";
export const DELIVERY_SCHEDULED_TEMPLATE = "delivery_scheduled";
export const OUT_FOR_DELIVERY_TEMPLATE = "out_for_delivery";
export const DELIVERED_TEMPLATE = "delivered";
export const REFUND_ISSUED_TEMPLATE = "refund_issued";

export const CUSTOMER_EMAIL_TEMPLATES = [
  ORDER_CONFIRMATION_TEMPLATE,
  DELIVERY_SCHEDULED_TEMPLATE,
  OUT_FOR_DELIVERY_TEMPLATE,
  DELIVERED_TEMPLATE,
  REFUND_ISSUED_TEMPLATE,
] as const;

export type CustomerEmailTemplate =
  (typeof CUSTOMER_EMAIL_TEMPLATES)[number];

export const RESENDABLE_EMAIL_TEMPLATES = [
  ORDER_CONFIRMATION_TEMPLATE,
  DELIVERY_SCHEDULED_TEMPLATE,
  OUT_FOR_DELIVERY_TEMPLATE,
  DELIVERED_TEMPLATE,
] as const;

export type ResendableEmailTemplate =
  (typeof RESENDABLE_EMAIL_TEMPLATES)[number];

export function isCustomerEmailTemplate(
  value: string | null,
): value is CustomerEmailTemplate {
  return (
    typeof value === "string" &&
    (CUSTOMER_EMAIL_TEMPLATES as readonly string[]).includes(value)
  );
}

export function isResendableEmailTemplate(
  value: string,
): value is ResendableEmailTemplate {
  return (RESENDABLE_EMAIL_TEMPLATES as readonly string[]).includes(
    value,
  );
}

export function logSkippedNoEmail(orderNumber?: string): void {
  console.info(
    `Email skipped, no email address${
      orderNumber ? ` (order ${orderNumber})` : ""
    }.`,
  );
}

const ERROR_LIMIT = 500;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type EnqueueNotificationInput = {
  template: string;
  orderId: string;
  toAddress: string;
  dedupeKey: string;
};

export type EnqueueNotificationResult = {
  inserted: boolean;
  id: string | null;
};

export type DispatchNotificationResult = {
  status: "sent" | "logged" | "failed" | "skipped";
  error?: string;
};

export function maskEmailAddress(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");

  if (at <= 0) {
    return "***";
  }

  const local = trimmed.slice(0, Math.min(2, at));

  return `${local}***${trimmed.slice(at)}`;
}

export function maskEmailsInText(value: string): string {
  return value.replace(EMAIL_PATTERN, (email) => maskEmailAddress(email));
}

export function truncateError(
  value: string,
  limit = ERROR_LIMIT,
): string {
  const masked = maskEmailsInText(value).trim();

  return masked.length > limit ? `${masked.slice(0, limit - 1)}…` : masked;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown email error.";
}

export function refundRowKeyFromDedupeKey(
  dedupeKey: string | null,
): string | null {
  const prefix = `${REFUND_ISSUED_TEMPLATE}:`;

  if (!dedupeKey?.startsWith(prefix)) {
    return null;
  }

  const rowKey = dedupeKey.slice(prefix.length);

  return rowKey || null;
}

export async function enqueueNotification(
  input: EnqueueNotificationInput,
): Promise<EnqueueNotificationResult> {
  if (!db) {
    return { inserted: false, id: null };
  }

  try {
    const [row] = await db
      .insert(notificationsLog)
      .values({
        orderId: input.orderId,
        channel: "email",
        template: input.template,
        toAddress: input.toAddress,
        dedupeKey: input.dedupeKey,
        status: "queued",
        attempts: 0,
      })
      .onConflictDoNothing({ target: notificationsLog.dedupeKey })
      .returning({ id: notificationsLog.id });

    return {
      inserted: Boolean(row),
      id: row?.id ?? null,
    };
  } catch (error) {
    console.error(
      "Notification enqueue failed:",
      truncateError(errorMessage(error)),
    );

    return { inserted: false, id: null };
  }
}

async function markSkipped(
  notification: NotificationLog,
  message: string,
): Promise<DispatchNotificationResult> {
  if (db) {
    try {
      await db
        .update(notificationsLog)
        .set({
          status: "logged",
          error: message,
          updatedAt: new Date(),
        })
        .where(eq(notificationsLog.id, notification.id));
    } catch (error) {
      console.error(
        "Notification skip update failed:",
        truncateError(errorMessage(error)),
      );
    }
  }

  return { status: "logged", error: message };
}

export async function dispatchNotification(
  id: string,
): Promise<DispatchNotificationResult> {
  if (!db) {
    return { status: "skipped" };
  }

  try {
    const [notification] = await db
      .select()
      .from(notificationsLog)
      .where(eq(notificationsLog.id, id))
      .limit(1);

    if (!notification) {
      return { status: "skipped" };
    }

    if (
      notification.status === "sent" ||
      notification.status === "logged" ||
      notification.status === "delivered"
    ) {
      return {
        status:
          notification.status === "delivered"
            ? "sent"
            : notification.status,
      };
    }

    if (!notification.orderId) {
      return markSkipped(notification, "Skipped: no order is linked.");
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, notification.orderId))
      .limit(1);

    if (!order) {
      return markSkipped(notification, "Skipped: order not found.");
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const settings = await readStoreSettings(db);

    const customerEmail = order.email.trim();
    const storeEmail = settings.email.trim();
    const template = notification.template;
    const customerTemplate = isCustomerEmailTemplate(template);

    if (customerTemplate) {
      if (!customerEmail) {
        return markSkipped(
          notification,
          "Skipped: no customer email address.",
        );
      }
    } else if (template === OWNER_NEW_ORDER_TEMPLATE) {
      if (!storeEmail) {
        return markSkipped(notification, "Skipped: no store email address.");
      }
    } else {
      throw new Error("Unknown email template.");
    }

    const itemCount = items.reduce(
      (total, item) => total + item.quantity,
      0,
    );
    let rendered: RenderedEmail;

    if (template === ORDER_CONFIRMATION_TEMPLATE) {
      rendered = renderOrderConfirmation({
        orderNumber: order.orderNumber,
        items: items.map((item) => ({
          name: item.nameSnapshot,
          quantity: item.quantity,
          lineTotalCents: item.lineTotalCents,
        })),
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        deliveryFeeCents: order.deliveryFeeCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        shippingAddress: {
          name: order.shippingName,
          line1: order.shippingLine1,
          line2: order.shippingLine2,
          city: order.shippingCity,
          state: order.shippingState,
          zip: order.shippingZip,
        },
        webOrigin: env.WEB_ORIGIN,
        storeName: settings.store_name,
      });
    } else if (template === OWNER_NEW_ORDER_TEMPLATE) {
      rendered = renderOwnerNewOrder({
        orderNumber: order.orderNumber,
        customerName: order.shippingName,
        itemCount,
        totalCents: order.totalCents,
        webOrigin: env.WEB_ORIGIN,
        storeName: settings.store_name,
      });
    } else {
      let delivery: typeof deliveries.$inferSelect | null = null;

      if (
        template === DELIVERY_SCHEDULED_TEMPLATE ||
        template === OUT_FOR_DELIVERY_TEMPLATE
      ) {
        const [deliveryRow] = await db
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, order.id))
          .limit(1);

        delivery = deliveryRow ?? null;
      }

      if (template === DELIVERY_SCHEDULED_TEMPLATE) {
        if (!delivery?.scheduledDate) {
          return markSkipped(
            notification,
            "Skipped: no delivery date is set.",
          );
        }

        const priorScheduled = await db
          .select({ id: notificationsLog.id })
          .from(notificationsLog)
          .where(
            and(
              eq(notificationsLog.orderId, order.id),
              eq(
                notificationsLog.template,
                DELIVERY_SCHEDULED_TEMPLATE,
              ),
              inArray(notificationsLog.status, [
                "sent",
                "logged",
                "delivered",
              ]),
            ),
          )
          .limit(1);

        rendered = renderDeliveryScheduled({
          orderNumber: order.orderNumber,
          scheduledDate: delivery.scheduledDate,
          timeWindow: delivery.timeWindow,
          deliveryCompany: delivery.partnerName,
          storeEmail,
          webOrigin: env.WEB_ORIGIN,
          storeName: settings.store_name,
          dateChanged: priorScheduled.length > 0,
        });
      } else if (template === OUT_FOR_DELIVERY_TEMPLATE) {
        rendered = renderOutForDelivery({
          orderNumber: order.orderNumber,
          deliveryCompany: delivery?.partnerName ?? null,
          trackingNumber: delivery?.trackingNumber ?? null,
          scheduledDate: delivery?.scheduledDate ?? null,
          timeWindow: delivery?.timeWindow ?? null,
          webOrigin: env.WEB_ORIGIN,
          storeName: settings.store_name,
        });
      } else if (template === DELIVERED_TEMPLATE) {
        rendered = renderDelivered({
          orderNumber: order.orderNumber,
          webOrigin: env.WEB_ORIGIN,
          storeName: settings.store_name,
        });
      } else {
        const refundRowKey = refundRowKeyFromDedupeKey(
          notification.dedupeKey,
        );
        const paymentRows = await db
          .select({
            rawEventId: payments.rawEventId,
            amountCents: payments.amountCents,
            status: payments.status,
          })
          .from(payments)
          .where(eq(payments.orderId, order.id));
        const refundedRows = paymentRows.filter(
          (payment) => payment.status === "refunded",
        );
        const refundRow = refundedRows.find(
          (payment) => payment.rawEventId === refundRowKey,
        );

        if (!refundRow) {
          return markSkipped(
            notification,
            "Skipped: refund entry not found.",
          );
        }

        rendered = renderRefundIssued({
          orderNumber: order.orderNumber,
          amountCents: refundRow.amountCents,
          totalRefundedCents: refundedRows.reduce(
            (total, payment) => total + payment.amountCents,
            0,
          ),
          webOrigin: env.WEB_ORIGIN,
          storeName: settings.store_name,
        });
      }
    }

    const sender = getEmailSender();
    const { providerMessageId } = await sender.send({
      to: customerTemplate ? customerEmail : storeEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(storeEmail ? { replyTo: storeEmail } : {}),
      ...(notification.dedupeKey
        ? { dedupeKey: notification.dedupeKey }
        : {}),
      fromName: settings.store_name,
    });
    const sentAt = new Date();
    const status = sender.name === "log" ? "logged" : "sent";

    await db
      .update(notificationsLog)
      .set({
        status,
        providerMessageId,
        sentAt,
        error: null,
        attempts: sql`${notificationsLog.attempts} + 1`,
        updatedAt: sentAt,
      })
      .where(eq(notificationsLog.id, notification.id));

    return { status };
  } catch (error) {
    const message = truncateError(errorMessage(error));

    console.error("Notification dispatch failed:", message);

    if (db) {
      try {
        await db
          .update(notificationsLog)
          .set({
            status: "failed",
            error: message,
            attempts: sql`${notificationsLog.attempts} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(notificationsLog.id, id));
      } catch (updateError) {
        console.error(
          "Notification failure update failed:",
          truncateError(errorMessage(updateError)),
        );
      }
    }

    return { status: "failed", error: message };
  }
}
