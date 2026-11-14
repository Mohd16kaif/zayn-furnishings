import type { AdminOrderStatus } from "./adminApi";
import { formatCents } from "./money";

export const REFUND_REASON_OPTIONS = [
  { value: "requested_by_customer", label: "Customer asked for it" },
  { value: "damaged", label: "Item damaged or faulty" },
  { value: "unavailable", label: "Item unavailable" },
  { value: "other", label: "Other" },
] as const;

export function refundReasonLabel(reason: string | null): string {
  switch (reason) {
    case "requested_by_customer":
      return "Customer asked for it";
    case "damaged":
      return "Item damaged or faulty";
    case "unavailable":
      return "Item unavailable";
    case "other":
      return "Other";
    default:
      return "Reason not recorded";
  }
}

export function orderStatusLabel(status: AdminOrderStatus | string): string {
  switch (status) {
    case "pending":
      return "Awaiting payment";
    case "paid":
      return "Paid";
    case "processing":
      return "Preparing";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
    case "partially_refunded":
      return "Partially refunded";
    default:
      return formatWords(status);
  }
}

export function orderStatusBadgeClass(
  status: AdminOrderStatus | string,
): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "paid":
      return "bg-blue-100 text-blue-800";
    case "processing":
      return "bg-indigo-100 text-indigo-800";
    case "out_for_delivery":
      return "bg-purple-100 text-purple-800";
    case "delivered":
      return "bg-green-100 text-green-800";
    case "cancelled":
      return "bg-stone-200 text-stone-700";
    case "refunded":
    case "partially_refunded":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

export function deliveryStatusLabel(status: string | null): string {
  switch (status) {
    case "pending":
      return "Not scheduled";
    case "scheduled":
      return "Scheduled";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case null:
    case "":
      return "No delivery";
    default:
      return formatWords(status);
  }
}

export function deliveryMethodLabel(method: string | null): string {
  switch (method) {
    case "own_truck":
      return "Our truck";
    case "freight":
      return "Freight";
    case "white_glove":
      return "White glove";
    case "pickup":
      return "Pickup";
    case "carrier_parcel":
      return "Carrier";
    case null:
    case "":
      return "Not set";
    default:
      return formatWords(method);
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "succeeded":
      return "Paid";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    default:
      return formatWords(status);
  }
}

export function orderActivityLabel(action: string): string {
  switch (action) {
    case "order.status_changed":
      return "Status changed";
    case "order.note_added":
      return "Note added";
    case "order.stock_shortage":
      return "Stock shortage flagged";
    case "order.delivery_updated":
      return "Delivery updated";
    case "order.refunded":
      return "Refund issued";
    case "order.stale_pending_cancelled":
      return "Unpaid order cancelled automatically";
    default:
      return formatWords(action.replace(/^order\./, ""));
  }
}

export function describeOrderActivity(activity: {
  action: string;
  details: unknown;
}): string | null {
  const details = asRecord(activity.details);
  const note =
    typeof details?.note === "string" && details.note.trim()
      ? details.note.trim()
      : null;

  if (activity.action === "order.status_changed") {
    const from =
      typeof details?.from === "string" ? details.from : null;
    const to = typeof details?.to === "string" ? details.to : null;

    if (from && to) {
      const deliveryBefore =
        typeof details?.delivery_status_before === "string"
          ? details.delivery_status_before
          : null;
      const deliveryAfter =
        typeof details?.delivery_status_after === "string"
          ? details.delivery_status_after
          : null;
      const deliveryChanged = details?.delivery_changed === true;
      const deliveryNote =
        deliveryChanged && deliveryBefore && deliveryAfter
          ? ` Delivery status changed from ${deliveryStatusLabel(
              deliveryBefore,
            )} to ${deliveryStatusLabel(deliveryAfter)}.`
          : "";

      return `From ${orderStatusLabel(from)} to ${orderStatusLabel(to)}.${
        note ? ` ${note}` : ""
      }${deliveryNote}`;
    }

    return note;
  }

  if (activity.action === "order.note_added") {
    return note;
  }

  if (activity.action === "order.stock_shortage") {
    const shortfalls = details?.shortfalls;

    if (Array.isArray(shortfalls)) {
      const lines = shortfalls
        .map((shortfall) => {
          const entry = asRecord(shortfall);
          if (!entry || typeof entry.name !== "string") {
            return null;
          }

          const requested =
            typeof entry.requested_qty === "number"
              ? entry.requested_qty
              : null;
          const available =
            typeof entry.available_qty === "number"
              ? entry.available_qty
              : null;

          if (requested !== null && available !== null) {
            return `${entry.name}: ${requested} requested, ${available} available`;
          }

          return entry.name;
        })
        .filter((line): line is string => line !== null);

      if (lines.length > 0) {
        return lines.join("; ");
      }
    }

    return null;
  }

  if (activity.action === "order.delivery_updated") {
    const parts: string[] = [];
    const orderBefore = details?.order_status_before;
    const orderAfter = details?.order_status_after;

    if (
      typeof orderBefore === "string" &&
      typeof orderAfter === "string" &&
      orderBefore !== orderAfter
    ) {
      parts.push(
        `Order status changed from ${orderStatusLabel(
          orderBefore,
        )} to ${orderStatusLabel(orderAfter)}.`,
      );
    }

    const changedFields = details?.changed_fields;

    if (Array.isArray(changedFields) && changedFields.length > 0) {
      const labels = changedFields
        .filter((field): field is string => typeof field === "string")
        .map(deliveryFieldLabel);

      if (labels.length > 0) {
        parts.push(`Updated ${labels.join(", ")}.`);
      }
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (activity.action === "order.refunded") {
    const parts: string[] = [];
    const amountCents =
      typeof details?.amount_cents === "number"
        ? details.amount_cents
        : null;

    if (amountCents !== null) {
      parts.push(`${formatCents(amountCents)} was refunded.`);
    }

    if (typeof details?.reason === "string") {
      parts.push(`Reason: ${refundReasonLabel(details.reason)}.`);
    }

    if (details?.restocked === true) {
      parts.push("Items were put back in stock.");
    }

    if (note) {
      parts.push(note);
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (activity.action === "order.stale_pending_cancelled") {
    return "The order was cancelled automatically because it stayed unpaid.";
  }

  return note;
}

function deliveryFieldLabel(field: string): string {
  switch (field) {
    case "method":
      return "delivery method";
    case "partner_name":
      return "delivery company";
    case "tracking_number":
      return "tracking number";
    case "scheduled_date":
      return "delivery date";
    case "time_window":
      return "time window";
    case "status":
      return "delivery status";
    case "delivered_at":
      return "delivered date";
    case "driver_notes":
      return "driver notes";
    default:
      return formatWords(field);
  }
}

export function formatAdminDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatAdminDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatAdminDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWords(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();

  if (!words) {
    return "Unknown";
  }

  return words
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
