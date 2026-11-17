import { eq, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  notificationsLog,
  orderItems,
  orders,
  type NotificationLog,
} from "../db/schema";
import { readStoreSettings } from "../lib/storeSettings";
import { getEmailSender } from "./sender";
import { renderOrderConfirmation } from "./templates/orderConfirmation";
import { renderOwnerNewOrder } from "./templates/ownerNewOrder";

export const ORDER_CONFIRMATION_TEMPLATE = "order_confirmation";
export const OWNER_NEW_ORDER_TEMPLATE = "owner_new_order";

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

    if (notification.template === ORDER_CONFIRMATION_TEMPLATE) {
      if (!customerEmail) {
        return markSkipped(
          notification,
          "Skipped: no customer email address.",
        );
      }
    } else if (notification.template === OWNER_NEW_ORDER_TEMPLATE) {
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
    const rendered =
      notification.template === ORDER_CONFIRMATION_TEMPLATE
        ? renderOrderConfirmation({
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
          })
        : renderOwnerNewOrder({
            orderNumber: order.orderNumber,
            customerName: order.shippingName,
            itemCount,
            totalCents: order.totalCents,
            webOrigin: env.WEB_ORIGIN,
            storeName: settings.store_name,
          });
    const sender = getEmailSender();
    const { providerMessageId } = await sender.send({
      to:
        notification.template === ORDER_CONFIRMATION_TEMPLATE
          ? customerEmail
          : storeEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(storeEmail ? { replyTo: storeEmail } : {}),
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
