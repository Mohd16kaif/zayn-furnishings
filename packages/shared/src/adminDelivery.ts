import { z } from "zod";
import {
  FULFILLMENT_STATUSES,
  canTransition,
  type AdminRole,
  type OrderStatus,
} from "./orderTransitions";

export const DELIVERY_METHODS = [
  "own_truck",
  "freight",
  "white_glove",
  "pickup",
  "carrier_parcel",
] as const;

export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const DELIVERY_STATUSES = [
  "pending",
  "scheduled",
  "out_for_delivery",
  "delivered",
  "failed",
  "cancelled",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

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

export const deliveryUpdateSchema = z
  .object({
    method: z.enum(DELIVERY_METHODS),
    partner_name: z
      .string()
      .trim()
      .max(
        120,
        "The delivery company must be 120 characters or fewer.",
      )
      .nullable()
      .optional(),
    tracking: z
      .string()
      .trim()
      .max(120, "The tracking number must be 120 characters or fewer.")
      .nullable()
      .optional(),
    scheduled_date: dateOnlySchema.nullable().optional(),
    time_window: z
      .string()
      .trim()
      .max(40, "The time window must be 40 characters or fewer.")
      .nullable()
      .optional(),
    driver_notes: z
      .string()
      .trim()
      .max(1000, "Driver notes must be 1,000 characters or fewer.")
      .nullable()
      .optional(),
    status: z.enum(DELIVERY_STATUSES),
  })
  .strict();

export type DeliveryUpdateInput = z.infer<typeof deliveryUpdateSchema>;

const DELIVERY_BLOCKED_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

export function isDeliveryOrderBlocked(orderStatus: OrderStatus): boolean {
  return DELIVERY_BLOCKED_ORDER_STATUSES.has(orderStatus);
}

export type DeliveryOrderSyncResult =
  | { status: "no_change" }
  | { status: "advance"; orderStatus: OrderStatus }
  | {
      status: "error";
      reason: "delivery_unavailable" | "transition_not_allowed";
    };

function fulfillmentIndex(status: OrderStatus): number {
  return (FULFILLMENT_STATUSES as readonly string[]).indexOf(status);
}

/**
 * Keeps the order status in step with delivery updates. Delivery changes never
 * move an order backward, and paid/processing orders can jump straight to the
 * matching fulfillment step.
 */
export function deliveryOrderSync(
  deliveryStatus: DeliveryStatus,
  orderStatus: OrderStatus,
  role: AdminRole,
): DeliveryOrderSyncResult {
  if (isDeliveryOrderBlocked(orderStatus)) {
    return { status: "error", reason: "delivery_unavailable" };
  }

  let target: OrderStatus | null = null;

  if (deliveryStatus === "out_for_delivery") {
    target = "out_for_delivery";
  } else if (deliveryStatus === "delivered") {
    target = "delivered";
  }

  if (!target) {
    return { status: "no_change" };
  }

  const currentIndex = fulfillmentIndex(orderStatus);
  const targetIndex = fulfillmentIndex(target);

  if (currentIndex === -1 || targetIndex === -1) {
    return { status: "error", reason: "transition_not_allowed" };
  }

  if (currentIndex >= targetIndex) {
    return { status: "no_change" };
  }

  if (!canTransition(orderStatus, target, role)) {
    return { status: "error", reason: "transition_not_allowed" };
  }

  return { status: "advance", orderStatus: target };
}
