import {
  ORDER_STATUSES,
  canTransition,
  deliveryEmailEvents,
  deliveryOrderSync,
  deliveryStatusForOrderStatus,
  deliveryUpdateSchema,
  isBackwardFulfillmentTransition,
  isDeliveryOrderBlocked,
  isManualStatusBlocked,
  type OrderStatus,
} from "@zayn/shared";
import { randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db/client";
import {
  adminUsers,
  auditLog,
  customers,
  deliveries,
  notificationsLog,
  orderItems,
  orders,
  payments,
} from "../db/schema";
import { scheduleDeliveryEmails } from "../emails/deliveryNotifications";
import {
  CUSTOMER_EMAIL_TEMPLATES,
  DELIVERY_SCHEDULED_TEMPLATE,
  DELIVERED_TEMPLATE,
  ORDER_CONFIRMATION_TEMPLATE,
  OUT_FOR_DELIVERY_TEMPLATE,
  dispatchNotification,
  enqueueNotification,
  isResendableEmailTemplate,
  logSkippedNoEmail,
  maskEmailAddress,
  truncateError,
} from "../emails/outbox";
import { scheduleRefundIssuedEmails } from "../emails/refundNotifications";
import {
  HttpError,
  sendError,
  sendValidationError,
  writeAudit,
} from "../lib/adminCatalog";
import {
  REFUNDABLE_ORDER_STATUSES,
  applyRefundState,
  refundIdFromRawEventId,
  summarizeRefunds,
  validateRefundRequest,
} from "../lib/refundLedger";
import { restockRefundedOrder } from "../lib/refundRestock";
import { STRIPE_API_VERSION, stripe } from "../lib/stripe";
import { requireAdmin } from "../middleware/requireAdmin";

const ORDER_NUMBER_PATTERN = /^ZF-\d+$/;
const REFUND_STRIPE_TIMEOUT_MS = 10_000;
const REFUND_RATE_LIMIT = 10;
const REFUND_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RESEND_RATE_LIMIT = 5;
const MESSAGE_ERROR_LIMIT = 160;
const PAID_OR_LATER_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "partially_refunded",
  "refunded",
]);

export function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export const STOCK_SHORTAGE_MARKER = "STOCK SHORTAGE";

export function hasStockShortage(
  notes: string | null | undefined,
): boolean {
  return new RegExp(STOCK_SHORTAGE_MARKER, "i").test(notes ?? "");
}

export function formatNoteTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function appendOrderNote(
  existing: string | null,
  adminLabel: string,
  text: string,
  now: Date = new Date(),
): string {
  const line = `[${formatNoteTimestamp(now)}] ${adminLabel}: ${text}`;

  return existing ? `${existing}\n${line}` : line;
}

function adminLabel(admin: { name: string | null; email: string }): string {
  const name = admin.name?.replace(/\s+/g, " ").trim();

  return name || admin.email;
}

function readOrderNumber(req: Request, res: Response): string | null {
  const parsed = z
    .string()
    .trim()
    .regex(ORDER_NUMBER_PATTERN)
    .safeParse(req.params.orderNumber);

  if (!parsed.success) {
    res.status(404).json({ error: "Order not found." });
    return null;
  }

  return parsed.data;
}

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Enter a valid date.");

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfNextUtcDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + 1));
}

const statusListSchema = z
  .string()
  .trim()
  .min(1, "Choose at least one status.")
  .refine((value) => {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return (
      parts.length > 0 &&
      parts.every((part) =>
        (ORDER_STATUSES as readonly string[]).includes(part),
      )
    );
  }, `Status must be one or more of: ${ORDER_STATUSES.join(", ")}.`);

const orderListQuerySchema = z
  .object({
    status: statusListSchema.optional(),
    q: z.string().trim().max(200).optional(),
    date_from: dateOnlySchema.optional(),
    date_to: dateOnlySchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (value) =>
      !value.date_from ||
      !value.date_to ||
      value.date_from <= value.date_to,
    {
      message: "date_to must be on or after date_from.",
      path: ["date_to"],
    },
  );

function statusesFromFilter(value: string | undefined): OrderStatus[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ) as OrderStatus[];
}

const statusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(1000).optional(),
});

const noteCreateSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Enter a note.")
    .max(1000, "Notes must be 1,000 characters or fewer."),
});

const REFUND_REASONS = [
  "requested_by_customer",
  "damaged",
  "unavailable",
  "other",
] as const;

const refundRequestSchema = z
  .object({
    request_id: z.string().uuid("A valid request id is required."),
    amount_cents: z
      .number()
      .int("Enter the refund amount in whole cents.")
      .min(1, "Enter a refund amount of at least $0.01.")
      .optional(),
    reason: z.enum(REFUND_REASONS),
    note: z
      .string()
      .trim()
      .min(1, "Enter a short note explaining the refund.")
      .max(500, "The note must be 500 characters or fewer."),
    restock: z.boolean().default(false),
  })
  .strict();

const refundRateLimiter = rateLimit({
  windowMs: REFUND_RATE_LIMIT_WINDOW_MS,
  limit: REFUND_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.admin?.id ?? ipKeyGenerator(req.ip ?? ""),
  message: {
    error: "Too many refund attempts. Please wait a minute and try again.",
  },
});

const resendRateLimiter = rateLimit({
  windowMs: REFUND_RATE_LIMIT_WINDOW_MS,
  limit: RESEND_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.admin?.id ?? ipKeyGenerator(req.ip ?? ""),
  message: {
    error: "Too many email resends. Please wait a minute and try again.",
  },
});

async function cancelPaymentIntent(
  paymentIntentId: string,
): Promise<boolean> {
  if (!stripe) {
    throw new HttpError(
      503,
      "Online payments are temporarily unavailable.",
    );
  }

  let intent;

  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (error) {
    console.error(
      "Failed to read PaymentIntent before cancellation:",
      error instanceof Error ? error.message : error,
    );
    throw new HttpError(
      502,
      "We could not check the payment. Please try again.",
    );
  }

  if (intent.status === "succeeded") {
    throw new HttpError(409, "Payment was received, refresh the order");
  }

  if (intent.status === "canceled") {
    return true;
  }

  try {
    const cancelled = await stripe.paymentIntents.cancel(paymentIntentId);

    return cancelled.status === "canceled";
  } catch (error) {
    let latestStatus: string | null = null;

    try {
      const latest = await stripe.paymentIntents.retrieve(paymentIntentId);
      latestStatus = latest.status;
    } catch {
      latestStatus = null;
    }

    if (latestStatus === "succeeded") {
      throw new HttpError(409, "Payment was received, refresh the order");
    }

    console.error(
      "PaymentIntent cancellation failed:",
      error instanceof Error ? error.message : error,
    );
    throw new HttpError(
      502,
      "We could not cancel the payment. Please try again.",
    );
  }
}

function serializeDelivery(delivery: typeof deliveries.$inferSelect) {
  return {
    status: delivery.status,
    method: delivery.method,
    partner_name: delivery.partnerName,
    scheduled_date: delivery.scheduledDate,
    time_window: delivery.timeWindow,
    tracking_number: delivery.trackingNumber,
    carrier: delivery.carrier,
    driver_notes: delivery.driverNotes,
    delivered_at: delivery.deliveredAt,
    created_at: delivery.createdAt,
    updated_at: delivery.updatedAt,
  };
}

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAdmin);

adminOrdersRouter.get(
  "/orders",
  async (req: Request, res: Response) => {
    const parsed = orderListQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const {
      q,
      date_from,
      date_to,
      page,
      page_size: pageSize,
    } = parsed.data;
    const statuses = statusesFromFilter(parsed.data.status);
    const offset = (page - 1) * pageSize;

    try {
      const conditions: SQL[] = [];

      if (statuses.length > 0) {
        conditions.push(inArray(orders.status, statuses));
      } else {
        conditions.push(ne(orders.status, "pending"));
      }

      if (date_from) {
        conditions.push(gte(orders.createdAt, startOfUtcDay(date_from)));
      }

      if (date_to) {
        conditions.push(
          lt(orders.createdAt, startOfNextUtcDay(date_to)),
        );
      }

      if (q) {
        const term = `%${escapeLikePattern(q)}%`;
        const searchConditions: SQL[] = [
          ilike(orders.orderNumber, term),
          ilike(orders.email, term),
          ilike(orders.shippingName, term),
          ilike(customers.name, term),
        ];
        const digits = q.replace(/\D/g, "");

        if (digits.length >= 3) {
          const digitTerm = `%${escapeLikePattern(digits)}%`;
          searchConditions.push(
            sql`regexp_replace(coalesce(${orders.shippingPhone}, ''), '[^0-9]', '', 'g') like ${digitTerm}`,
            sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${digitTerm}`,
          );
        }

        const search = or(...searchConditions);

        if (search) {
          conditions.push(search);
        }
      }

      const where = and(...conditions);

      const [rows, totalRows, statusCountRows] = await Promise.all([
        db
          .select({
            order: orders,
            customerName: customers.name,
            customerPhone: customers.phone,
            deliveryStatus: deliveries.status,
          })
          .from(orders)
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ value: count() })
          .from(orders)
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .where(where),
        db
          .select({ status: orders.status, value: count() })
          .from(orders)
          .groupBy(orders.status),
      ]);

      const total = Number(totalRows[0]?.value ?? 0);
      const itemCountByOrder = new Map<string, number>();
      const orderIds = rows.map((row) => row.order.id);

      if (orderIds.length > 0) {
        const itemCounts = await db
          .select({
            orderId: orderItems.orderId,
            value: sum(orderItems.quantity),
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds))
          .groupBy(orderItems.orderId);

        for (const row of itemCounts) {
          itemCountByOrder.set(row.orderId, Number(row.value ?? 0));
        }
      }

      const countsByStatus = Object.fromEntries(
        ORDER_STATUSES.map((status) => [status, 0]),
      ) as Record<OrderStatus, number>;

      for (const row of statusCountRows) {
        countsByStatus[row.status] = Number(row.value);
      }

      res.set("Cache-Control", "no-store");
      res.json({
        items: rows.map((row) => ({
          order_number: row.order.orderNumber,
          status: row.order.status,
          total_cents: row.order.totalCents,
          created_at: row.order.createdAt,
          customer_name:
            row.order.shippingName ?? row.customerName ?? null,
          customer_phone:
            row.order.shippingPhone ?? row.customerPhone ?? null,
          item_count: itemCountByOrder.get(row.order.id) ?? 0,
          delivery_status: row.deliveryStatus ?? null,
          has_stock_shortage: hasStockShortage(
            row.order.internalNotes,
          ),
        })),
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.ceil(total / pageSize),
          has_more: offset + rows.length < total,
        },
        counts_by_status: countsByStatus,
      });
    } catch (error) {
      sendError(res, error, "Failed to load orders");
    }
  },
);

adminOrdersRouter.get(
  "/orders/:orderNumber",
  async (req: Request, res: Response) => {
    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const [row] = await db
        .select({ order: orders, customer: customers })
        .from(orders)
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Order not found." });
        return;
      }

      const order = row.order;

      const [
        itemRows,
        paymentRows,
        deliveryRows,
        activityRows,
        refundAuditRows,
        messageRows,
      ] = await Promise.all([
        db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id)),
        db
          .select()
          .from(payments)
          .where(eq(payments.orderId, order.id))
          .orderBy(payments.createdAt),
        db
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, order.id))
          .limit(1),
        db
          .select({
            action: auditLog.action,
            adminEmail: adminUsers.email,
            createdAt: auditLog.createdAt,
            details: auditLog.details,
          })
          .from(auditLog)
          .leftJoin(
            adminUsers,
            eq(auditLog.adminUserId, adminUsers.id),
          )
          .where(
            and(
              eq(auditLog.entity, "order"),
              eq(auditLog.entityId, order.id),
            ),
          )
          .orderBy(desc(auditLog.createdAt))
          .limit(50),
        db
          .select({ details: auditLog.details })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entity, "order"),
              eq(auditLog.entityId, order.id),
              eq(auditLog.action, "order.refunded"),
            ),
          )
          .orderBy(desc(auditLog.createdAt))
          .limit(100),
        db
          .select({
            id: notificationsLog.id,
            template: notificationsLog.template,
            toAddress: notificationsLog.toAddress,
            status: notificationsLog.status,
            createdAt: notificationsLog.createdAt,
            sentAt: notificationsLog.sentAt,
            error: notificationsLog.error,
          })
          .from(notificationsLog)
          .where(
            and(
              eq(notificationsLog.orderId, order.id),
              eq(notificationsLog.channel, "email"),
              inArray(notificationsLog.template, [
                ...CUSTOMER_EMAIL_TEMPLATES,
              ]),
            ),
          )
          .orderBy(desc(notificationsLog.createdAt))
          .limit(100),
      ]);

      const delivery = deliveryRows[0] ?? null;
      const summary = summarizeRefunds(paymentRows, order.totalCents);
      const refundReasons = new Map<string, string>();

      for (const audit of refundAuditRows) {
        const details =
          typeof audit.details === "object" && audit.details !== null
            ? (audit.details as Record<string, unknown>)
            : null;
        const refundId =
          typeof details?.stripe_refund_id === "string"
            ? details.stripe_refund_id
            : null;
        const reason =
          typeof details?.reason === "string" ? details.reason : null;

        if (refundId && reason && !refundReasons.has(refundId)) {
          refundReasons.set(refundId, reason);
        }
      }

      const refunds = paymentRows
        .filter((payment) => payment.status === "refunded")
        .map((payment) => {
          const refundId =
            refundIdFromRawEventId(payment.rawEventId) ??
            (payment.providerPaymentId?.startsWith("re_")
              ? payment.providerPaymentId
              : null);

          return {
            amount_cents: payment.amountCents,
            created_at: payment.createdAt,
            reason: refundId
              ? (refundReasons.get(refundId) ?? null)
              : null,
          };
        });
      const hasSucceededStripePayment = paymentRows.some(
        (payment) =>
          payment.provider === "stripe" && payment.status === "succeeded",
      );
      const canRefund =
        req.admin?.role === "owner" &&
        REFUNDABLE_ORDER_STATUSES.has(order.status) &&
        hasSucceededStripePayment &&
        summary.refundableRemainingCents > 0;

      res.set("Cache-Control", "no-store");
      res.json({
        order_number: order.orderNumber,
        status: order.status,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        subtotal_cents: order.subtotalCents,
        discount_cents: order.discountCents,
        delivery_fee_cents: order.deliveryFeeCents,
        tax_cents: order.taxCents,
        total_cents: order.totalCents,
        discount_code: order.discountCode,
        customer: {
          name: order.shippingName ?? row.customer?.name ?? null,
          phone: order.shippingPhone ?? row.customer?.phone ?? null,
          receipt_email: order.email,
          sms_opt_in: row.customer?.smsOptIn ?? false,
        },
        shipping_address: {
          name: order.shippingName,
          line1: order.shippingLine1,
          line2: order.shippingLine2,
          city: order.shippingCity,
          state: order.shippingState,
          zip: order.shippingZip,
          phone: order.shippingPhone,
        },
        items: itemRows.map((item) => ({
          name: item.nameSnapshot,
          sku: item.skuSnapshot,
          image_url: item.imageUrlSnapshot,
          unit_price_cents: item.unitPriceCents,
          quantity: item.quantity,
          line_total_cents: item.lineTotalCents,
        })),
        payments: paymentRows
          .filter((payment) => payment.status !== "refunded")
          .map((payment) => ({
            provider: payment.provider,
            status: payment.status,
            amount_cents: payment.amountCents,
            created_at: payment.createdAt,
          })),
        refunds,
        total_refunded_cents: summary.totalRefundedCents,
        refundable_remaining_cents: summary.refundableRemainingCents,
        can_refund: canRefund,
        stripe_payment_intent_id: order.stripePaymentIntentId,
        delivery: delivery ? serializeDelivery(delivery) : null,
        messages: messageRows.map((message) => ({
          id: message.id,
          template: message.template,
          to_masked: maskEmailAddress(message.toAddress ?? ""),
          status: message.status,
          created_at: message.createdAt,
          sent_at: message.sentAt,
          error: message.error
            ? truncateError(message.error, MESSAGE_ERROR_LIMIT)
            : null,
        })),
        notes: order.internalNotes,
        has_stock_shortage: hasStockShortage(order.internalNotes),
        activity: activityRows.map((activity) => ({
          action: activity.action,
          admin_email: activity.adminEmail,
          created_at: activity.createdAt,
          details: activity.details,
        })),
      });
    } catch (error) {
      sendError(res, error, "Failed to load order");
    }
  },
);

adminOrdersRouter.patch(
  "/orders/:orderNumber/status",
  async (req: Request, res: Response) => {
    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    const parsed = statusUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const admin = req.admin!;
    const data = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.orderNumber, orderNumber))
          .limit(1)
          .for("update");

        if (!order) {
          throw new HttpError(404, "Order not found.");
        }

        const from = order.status;
        const to = data.status;

        if (!canTransition(from, to, admin.role)) {
          if (isManualStatusBlocked(to)) {
            throw new HttpError(
              409,
              `The status "${to}" cannot be set by hand. Refresh the order and try again.`,
            );
          }

          if (
            isBackwardFulfillmentTransition(from, to) &&
            admin.role !== "owner"
          ) {
            throw new HttpError(
              403,
              "Only an owner can move an order backward.",
            );
          }

          throw new HttpError(
            409,
            "This order has changed since you loaded it. Refresh the order and try again.",
          );
        }

        let paymentIntentCancelled = false;

        if (
          from === "pending" &&
          to === "cancelled" &&
          order.stripePaymentIntentId
        ) {
          paymentIntentCancelled = await cancelPaymentIntent(
            order.stripePaymentIntentId,
          );
        }

        const now = new Date();

        await tx
          .update(orders)
          .set({
            status: to,
            ...(to === "cancelled" ? { cancelledAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(orders.id, order.id));

        const [delivery] = await tx
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, order.id))
          .limit(1)
          .for("update");
        let deliveryStatusBefore: string | null = null;
        let deliveryStatusAfter: string | null = null;
        let deliveryChanged = false;

        if (delivery) {
          const nextDeliveryStatus = deliveryStatusForOrderStatus(to, {
            hasScheduledDate: Boolean(delivery.scheduledDate),
          });

          deliveryStatusBefore = delivery.status;

          if (nextDeliveryStatus !== null) {
            const nextDeliveredAt =
              nextDeliveryStatus === "delivered"
                ? (delivery.deliveredAt ?? now)
                : null;

            deliveryStatusAfter = nextDeliveryStatus;

            if (
              delivery.status !== nextDeliveryStatus ||
              delivery.deliveredAt?.getTime() !==
                nextDeliveredAt?.getTime()
            ) {
              deliveryChanged = true;

              await tx
                .update(deliveries)
                .set({
                  status: nextDeliveryStatus,
                  deliveredAt: nextDeliveredAt,
                  updatedAt: now,
                })
                .where(eq(deliveries.id, delivery.id));
            }
          }
        }

        await writeAudit(tx, {
          adminUserId: admin.id,
          action: "order.status_changed",
          entity: "order",
          entityId: order.id,
          details: {
            order_number: order.orderNumber,
            from,
            to,
            note: data.note ?? null,
            payment_intent_cancelled: paymentIntentCancelled,
            delivery_status_before: deliveryStatusBefore,
            delivery_status_after: deliveryStatusAfter,
            delivery_changed: deliveryChanged,
          },
        });

        const emailBefore = {
          orderStatus: from,
          deliveryStatus: delivery?.status ?? null,
          scheduledDate: delivery?.scheduledDate ?? null,
          timeWindow: delivery?.timeWindow ?? null,
        };
        const emailAfter = {
          orderStatus: to,
          deliveryStatus: deliveryStatusAfter ?? delivery?.status ?? null,
          scheduledDate: delivery?.scheduledDate ?? null,
          timeWindow: delivery?.timeWindow ?? null,
        };
        const emailEvents = deliveryEmailEvents({
          before: emailBefore,
          after: emailAfter,
        });

        return {
          order_number: order.orderNumber,
          status: to,
          updated_at: now,
          emailOrderId: order.id,
          emailOrderNumber: order.orderNumber,
          emailEvents,
          emailAfter,
        };
      });

      const {
        emailOrderId,
        emailOrderNumber,
        emailEvents,
        emailAfter,
        ...response
      } = result;

      try {
        scheduleDeliveryEmails({
          orderId: emailOrderId,
          orderNumber: emailOrderNumber,
          events: emailEvents,
          scheduledDate: emailAfter.scheduledDate,
          timeWindow: emailAfter.timeWindow,
        });
      } catch (emailError) {
        console.error(
          "Delivery email scheduling failed:",
          truncateError(
            emailError instanceof Error
              ? emailError.message
              : "Unknown email error.",
          ),
        );
      }

      res.json(response);
    } catch (error) {
      sendError(res, error, "Failed to update order status");
    }
  },
);

adminOrdersRouter.patch(
  "/orders/:orderNumber/delivery",
  async (req: Request, res: Response) => {
    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    const parsed = deliveryUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const admin = req.admin!;
    const data = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.orderNumber, orderNumber))
          .limit(1)
          .for("update");

        if (!order) {
          throw new HttpError(404, "Order not found.");
        }

        if (isDeliveryOrderBlocked(order.status)) {
          throw new HttpError(409, "Delivery can be managed after payment");
        }

        const today = new Date().toISOString().slice(0, 10);

        if (
          data.scheduled_date &&
          data.scheduled_date < today &&
          data.status !== "delivered"
        ) {
          throw new HttpError(
            400,
            "A delivery date in the past can only be saved when the delivery is marked delivered.",
          );
        }

        const [delivery] = await tx
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, order.id))
          .limit(1)
          .for("update");

        if (!delivery) {
          throw new HttpError(
            409,
            "Delivery details are not available yet. Refresh the order and try again.",
          );
        }

        const now = new Date();
        const next = {
          method: data.method,
          partnerName:
            data.partner_name === undefined
              ? delivery.partnerName
              : data.partner_name,
          trackingNumber:
            data.tracking === undefined
              ? delivery.trackingNumber
              : data.tracking,
          scheduledDate:
            data.scheduled_date === undefined
              ? delivery.scheduledDate
              : data.scheduled_date,
          timeWindow:
            data.time_window === undefined
              ? delivery.timeWindow
              : data.time_window,
          driverNotes:
            data.driver_notes === undefined
              ? delivery.driverNotes
              : data.driver_notes,
          status: data.status,
          deliveredAt:
            data.status === "delivered"
              ? (delivery.deliveredAt ?? now)
              : delivery.deliveredAt,
        };
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const changedFields: string[] = [];

        function record(
          field: string,
          beforeValue: unknown,
          afterValue: unknown,
        ) {
          if (beforeValue !== afterValue) {
            changedFields.push(field);
            before[field] = beforeValue;
            after[field] = afterValue;
          }
        }

        record("method", delivery.method, next.method);
        record("partner_name", delivery.partnerName, next.partnerName);
        record(
          "tracking_number",
          delivery.trackingNumber,
          next.trackingNumber,
        );
        record(
          "scheduled_date",
          delivery.scheduledDate,
          next.scheduledDate,
        );
        record("time_window", delivery.timeWindow, next.timeWindow);
        record("status", delivery.status, next.status);
        record("delivered_at", delivery.deliveredAt, next.deliveredAt);

        const driverNotesChanged =
          delivery.driverNotes !== next.driverNotes;

        if (driverNotesChanged) {
          changedFields.push("driver_notes");
        }

        if (changedFields.length === 0) {
          return {
            order_number: order.orderNumber,
            status: order.status,
            delivery: serializeDelivery(delivery),
            changed: false,
            emailOrderId: order.id,
            emailOrderNumber: order.orderNumber,
            emailEvents: [],
            emailScheduledDate: delivery.scheduledDate,
            emailTimeWindow: delivery.timeWindow,
          };
        }

        const deliveryStatusChanged = delivery.status !== next.status;
        const sync = deliveryStatusChanged
          ? deliveryOrderSync(next.status, order.status, admin.role)
          : ({ status: "no_change" } as const);

        if (sync.status === "error") {
          throw new HttpError(
            409,
            sync.reason === "delivery_unavailable"
              ? "Delivery can be managed after payment"
              : "This delivery status cannot be saved for the current order. Refresh the order and try again.",
          );
        }

        const [updatedDelivery] = await tx
          .update(deliveries)
          .set({ ...next, updatedAt: now })
          .where(eq(deliveries.id, delivery.id))
          .returning();

        if (!updatedDelivery) {
          throw new HttpError(
            500,
            "The delivery could not be saved. Please try again.",
          );
        }

        let orderStatus = order.status;

        if (sync.status === "advance") {
          await tx
            .update(orders)
            .set({ status: sync.orderStatus, updatedAt: now })
            .where(eq(orders.id, order.id));
          orderStatus = sync.orderStatus;
        }

        await writeAudit(tx, {
          adminUserId: admin.id,
          action: "order.delivery_updated",
          entity: "order",
          entityId: order.id,
          details: {
            order_number: order.orderNumber,
            changed_fields: changedFields,
            before,
            after,
            driver_notes_changed: driverNotesChanged,
            order_status_before: order.status,
            order_status_after: orderStatus,
          },
        });

        const emailEvents = deliveryEmailEvents({
          before: {
            orderStatus: order.status,
            deliveryStatus: delivery.status,
            scheduledDate: delivery.scheduledDate,
            timeWindow: delivery.timeWindow,
          },
          after: {
            orderStatus: orderStatus,
            deliveryStatus: updatedDelivery.status,
            scheduledDate: updatedDelivery.scheduledDate,
            timeWindow: updatedDelivery.timeWindow,
          },
        });

        return {
          order_number: order.orderNumber,
          status: orderStatus,
          delivery: serializeDelivery(updatedDelivery),
          changed: true,
          emailOrderId: order.id,
          emailOrderNumber: order.orderNumber,
          emailEvents,
          emailScheduledDate: updatedDelivery.scheduledDate,
          emailTimeWindow: updatedDelivery.timeWindow,
        };
      });

      const {
        emailOrderId,
        emailOrderNumber,
        emailEvents,
        emailScheduledDate,
        emailTimeWindow,
        ...response
      } = result;

      if (response.changed) {
        try {
          scheduleDeliveryEmails({
            orderId: emailOrderId,
            orderNumber: emailOrderNumber,
            events: emailEvents,
            scheduledDate: emailScheduledDate,
            timeWindow: emailTimeWindow,
          });
        } catch (emailError) {
          console.error(
            "Delivery email scheduling failed:",
            truncateError(
              emailError instanceof Error
                ? emailError.message
                : "Unknown email error.",
            ),
          );
        }
      }

      res.json(response);
    } catch (error) {
      sendError(res, error, "Failed to update delivery");
    }
  },
);

adminOrdersRouter.post(
  "/orders/:orderNumber/notes",
  async (req: Request, res: Response) => {
    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    const parsed = noteCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const admin = req.admin!;
    const text = parsed.data.text.replace(/\s+/g, " ").trim();

    try {
      const result = await db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            internalNotes: orders.internalNotes,
          })
          .from(orders)
          .where(eq(orders.orderNumber, orderNumber))
          .limit(1)
          .for("update");

        if (!order) {
          throw new HttpError(404, "Order not found.");
        }

        const now = new Date();
        const notes = appendOrderNote(
          order.internalNotes,
          adminLabel(admin),
          text,
          now,
        );

        await tx
          .update(orders)
          .set({ internalNotes: notes, updatedAt: now })
          .where(eq(orders.id, order.id));

        await writeAudit(tx, {
          adminUserId: admin.id,
          action: "order.note_added",
          entity: "order",
          entityId: order.id,
          details: {
            order_number: order.orderNumber,
            note: text,
          },
        });

        return {
          order_number: order.orderNumber,
          notes,
          updated_at: now,
        };
      });

      res.json(result);
    } catch (error) {
      sendError(res, error, "Failed to add order note");
    }
  },
);

adminOrdersRouter.post(
  "/orders/:orderNumber/messages/:template/resend",
  resendRateLimiter,
  async (req: Request, res: Response) => {
    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    const template = String(req.params.template ?? "");

    if (!isResendableEmailTemplate(template)) {
      res.status(404).json({ error: "This email cannot be resent." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const admin = req.admin!;

    try {
      const [order] = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          email: orders.email,
        })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);

      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      if (order.status === "pending" || order.status === "cancelled") {
        throw new HttpError(
          409,
          "This email cannot be sent for this order.",
        );
      }

      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.orderId, order.id))
        .limit(1);

      if (template === ORDER_CONFIRMATION_TEMPLATE) {
        if (!PAID_OR_LATER_ORDER_STATUSES.has(order.status)) {
          throw new HttpError(
            409,
            "This email can only be sent after payment.",
          );
        }
      } else if (template === DELIVERY_SCHEDULED_TEMPLATE) {
        if (!delivery?.scheduledDate) {
          throw new HttpError(
            409,
            "Add a delivery date before sending this email.",
          );
        }
      } else if (template === OUT_FOR_DELIVERY_TEMPLATE) {
        const out =
          order.status === "out_for_delivery" ||
          order.status === "delivered" ||
          delivery?.status === "out_for_delivery" ||
          delivery?.status === "delivered";

        if (!out) {
          throw new HttpError(
            409,
            "Mark the order out for delivery before sending this email.",
          );
        }
      } else if (template === DELIVERED_TEMPLATE) {
        const delivered =
          order.status === "delivered" ||
          delivery?.status === "delivered";

        if (!delivered) {
          throw new HttpError(
            409,
            "Mark the order delivered before sending this email.",
          );
        }
      }

      const toAddress = order.email.trim();

      if (!toAddress) {
        logSkippedNoEmail(order.orderNumber);
        throw new HttpError(409, "This order has no email address.");
      }

      const dedupeKey = `${template}:${order.id}:resend:${randomUUID()}`;
      const enqueued = await enqueueNotification({
        template,
        orderId: order.id,
        toAddress,
        dedupeKey,
      });

      if (!enqueued.inserted || !enqueued.id) {
        throw new HttpError(
          500,
          "The email could not be queued. Please try again.",
        );
      }

      await writeAudit(db, {
        adminUserId: admin.id,
        action: "order.message_resent",
        entity: "order",
        entityId: order.id,
        details: {
          order_number: order.orderNumber,
          template,
          notification_id: enqueued.id,
          dedupe_key: dedupeKey,
        },
      });

      await dispatchNotification(enqueued.id);

      res.json({
        ok: true,
        message: { id: enqueued.id, template },
      });
    } catch (error) {
      sendError(res, error, "Failed to resend the email");
    }
  },
);

adminOrdersRouter.post(
  "/orders/:orderNumber/refund",
  refundRateLimiter,
  async (req: Request, res: Response) => {
    const admin = req.admin!;

    if (admin.role !== "owner") {
      res.status(403).json({
        error: "Only the owner can issue refunds.",
      });
      return;
    }

    const orderNumber = readOrderNumber(req, res);

    if (!orderNumber) {
      return;
    }

    const parsed = refundRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    if (!stripe) {
      res.status(503).json({
        error: "Refunds are temporarily unavailable. Please try again later.",
      });
      return;
    }

    const data = parsed.data;

    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);

      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      const paymentRows = await db
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id));
      const summary = summarizeRefunds(paymentRows, order.totalCents);
      const validation = validateRefundRequest({
        orderStatus: order.status,
        hasSucceededStripePayment: paymentRows.some(
          (payment) =>
            payment.provider === "stripe" &&
            payment.status === "succeeded",
        ),
        paidAmountCents: summary.paidAmountCents,
        totalRefundedCents: summary.totalRefundedCents,
        amountCents: data.amount_cents,
        restock: data.restock,
      });

      if (!validation.ok) {
        throw new HttpError(validation.status, validation.message);
      }

      if (!order.stripePaymentIntentId) {
        throw new HttpError(
          409,
          "This order has no captured Stripe payment to refund.",
        );
      }

      const refundAmountCents = validation.amountCents;
      let refund;

      try {
        refund = await stripe.refunds.create(
          {
            payment_intent: order.stripePaymentIntentId,
            amount: refundAmountCents,
            metadata: { order_number: order.orderNumber },
            ...(data.reason === "requested_by_customer"
              ? { reason: "requested_by_customer" as const }
              : {}),
          },
          {
            idempotencyKey: `order-refund-${order.id}-${data.request_id}`,
            apiVersion: STRIPE_API_VERSION,
            timeout: REFUND_STRIPE_TIMEOUT_MS,
          },
        );
      } catch (error) {
        const stripeError = error as {
          type?: string;
          message?: string;
        };

        console.error(
          "Stripe refund failed:",
          stripeError.type ?? "unknown",
          stripeError.message ?? "no message",
        );

        if (
          stripeError.type === "StripeInvalidRequestError" ||
          stripeError.type === "StripeCardError"
        ) {
          throw new HttpError(
            409,
            "Stripe would not accept that refund. Refresh the order and try again.",
          );
        }

        throw new HttpError(
          502,
          "We could not confirm the refund with Stripe. Check the order before trying again.",
        );
      }

      if (!refund?.id) {
        throw new HttpError(
          502,
          "We could not confirm the refund with Stripe. Check the order before trying again.",
        );
      }

      if (refund.status === "failed" || refund.status === "canceled") {
        throw new HttpError(
          409,
          "Stripe did not complete the refund. Nothing was changed.",
        );
      }

      const refundedCents =
        Number.isInteger(refund.amount) && refund.amount > 0
          ? refund.amount
          : refundAmountCents;
      const refundCreatedAt = new Date(refund.created * 1000);
      let refundEmailRowKeys: string[] = [];

      const result = await db.transaction(async (tx) => {
        const ledger = await applyRefundState(tx, {
          orderId: order.id,
          refunds: [
            {
              id: refund.id,
              amountCents: refundedCents,
              createdAt: refundCreatedAt,
            },
          ],
        });
        refundEmailRowKeys = ledger.insertedRawEventIds;
        let restocked = false;

        if (data.restock && ledger.fullyRefunded) {
          const restock = await restockRefundedOrder(tx, {
            orderId: order.id,
            adminUserId: admin.id,
            note: data.note,
          });
          restocked = restock.restocked;
        }

        const refundAudits = await tx
          .select({ details: auditLog.details })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entity, "order"),
              eq(auditLog.entityId, order.id),
              eq(auditLog.action, "order.refunded"),
            ),
          );
        const alreadyAudited = refundAudits.some((audit) => {
          const details =
            typeof audit.details === "object" && audit.details !== null
              ? (audit.details as Record<string, unknown>)
              : null;

          return details?.stripe_refund_id === refund.id;
        });

        if (!alreadyAudited) {
          await writeAudit(tx, {
            adminUserId: admin.id,
            action: "order.refunded",
            entity: "order",
            entityId: order.id,
            details: {
              order_number: order.orderNumber,
              amount_cents: refundedCents,
              reason: data.reason,
              note: data.note,
              restock: data.restock,
              restocked,
              stripe_refund_id: refund.id,
              resulting_order_status: ledger.orderStatus,
            },
          });
        }

        return {
          order_number: order.orderNumber,
          status: ledger.orderStatus,
          refund: {
            stripe_refund_id: refund.id,
            amount_cents: refundedCents,
            created_at: refundCreatedAt,
          },
          total_refunded_cents: ledger.totalRefundedCents,
          refundable_remaining_cents: ledger.refundableRemainingCents,
          restocked,
        };
      });

      try {
        scheduleRefundIssuedEmails(order.id, refundEmailRowKeys);
      } catch (emailError) {
        console.error(
          "Refund email scheduling failed:",
          truncateError(
            emailError instanceof Error
              ? emailError.message
              : "Unknown email error.",
          ),
        );
      }

      res.json(result);
    } catch (error) {
      sendError(res, error, "Failed to refund order");
    }
  },
);
