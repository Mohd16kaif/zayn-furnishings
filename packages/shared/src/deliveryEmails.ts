import type { DeliveryStatus } from "./adminDelivery";
import {
  FULFILLMENT_STATUSES,
  type OrderStatus,
} from "./orderTransitions";

export type DeliveryEmailSnapshot = {
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus | string | null;
  scheduledDate: string | null;
  timeWindow: string | null;
};

export type DeliveryEmailTemplate =
  | "delivery_scheduled"
  | "out_for_delivery"
  | "delivered";

const DELIVERY_FLOW: ReadonlyArray<string> = [
  "pending",
  "scheduled",
  "out_for_delivery",
  "delivered",
];

const PAID_OR_LATER: ReadonlySet<OrderStatus> = new Set(
  FULFILLMENT_STATUSES,
);

const NO_EMAIL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "cancelled",
  "refunded",
  "partially_refunded",
]);

function stepIndex(flow: ReadonlyArray<string>, status: string | null): number {
  return status ? flow.indexOf(status) : -1;
}

function movedBackward(
  flow: ReadonlyArray<string>,
  before: string,
  after: string,
): boolean {
  const beforeIndex = stepIndex(flow, before);
  const afterIndex = stepIndex(flow, after);

  return beforeIndex !== -1 && afterIndex !== -1 && afterIndex < beforeIndex;
}

export function deliveryEmailEvents({
  before,
  after,
}: {
  before: DeliveryEmailSnapshot;
  after: DeliveryEmailSnapshot;
}): DeliveryEmailTemplate[] {
  if (NO_EMAIL_ORDER_STATUSES.has(after.orderStatus)) {
    return [];
  }

  const orderMovedBackward = movedBackward(
    FULFILLMENT_STATUSES,
    before.orderStatus,
    after.orderStatus,
  );
  const deliveryMovedBackward = movedBackward(
    DELIVERY_FLOW,
    before.deliveryStatus ?? "pending",
    after.deliveryStatus ?? "pending",
  );

  if (orderMovedBackward || deliveryMovedBackward) {
    return [];
  }

  const becameDelivered =
    (before.orderStatus !== "delivered" &&
      after.orderStatus === "delivered") ||
    (before.deliveryStatus !== "delivered" &&
      after.deliveryStatus === "delivered");

  if (becameDelivered) {
    return ["delivered"];
  }

  const becameOutForDelivery =
    (before.orderStatus !== "out_for_delivery" &&
      after.orderStatus === "out_for_delivery") ||
    (before.deliveryStatus !== "out_for_delivery" &&
      after.deliveryStatus === "out_for_delivery");
  const dateChanged =
    Boolean(after.scheduledDate) &&
    (before.scheduledDate !== after.scheduledDate ||
      (Boolean(before.scheduledDate) &&
        before.timeWindow !== after.timeWindow));
  const scheduleChanged =
    PAID_OR_LATER.has(after.orderStatus) && dateChanged;

  const events: DeliveryEmailTemplate[] = [];

  if (scheduleChanged) {
    events.push("delivery_scheduled");
  }

  if (becameOutForDelivery) {
    events.push("out_for_delivery");
  }

  return events;
}
