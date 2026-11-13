export const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type AdminRole = "owner" | "staff";

export const FULFILLMENT_STATUSES = [
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
] as const;

const MANUAL_STATUS_BLOCKLIST: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "paid",
  "refunded",
  "partially_refunded",
]);

export function isManualStatusBlocked(status: OrderStatus): boolean {
  return MANUAL_STATUS_BLOCKLIST.has(status);
}

export function isFulfillmentStatus(status: OrderStatus): boolean {
  return (FULFILLMENT_STATUSES as readonly string[]).includes(status);
}

export function isBackwardFulfillmentTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  const fromIndex = (FULFILLMENT_STATUSES as readonly string[]).indexOf(from);
  const toIndex = (FULFILLMENT_STATUSES as readonly string[]).indexOf(to);

  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }

  return toIndex < fromIndex;
}

/**
 * Admin-side status rules. Payment states are owned by Stripe and the refund
 * flow, so they can never be chosen by hand. Cancelling is only allowed from
 * pending; paid cancellations must go through the refund flow.
 */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: AdminRole,
): boolean {
  if (from === to || isManualStatusBlocked(to)) {
    return false;
  }

  if (from === "pending" && to === "cancelled") {
    return true;
  }

  const fromIndex = (FULFILLMENT_STATUSES as readonly string[]).indexOf(from);
  const toIndex = (FULFILLMENT_STATUSES as readonly string[]).indexOf(to);

  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }

  if (toIndex > fromIndex) {
    return true;
  }

  return role === "owner";
}
