import { pgEnum } from "drizzle-orm/pg-core";

export const productStatusEnum = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

export const deliveryMethodEnum = pgEnum("delivery_method", [
  "own_truck",
  "freight",
  "white_glove",
  "pickup",
  "carrier_parcel",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "scheduled",
  "out_for_delivery",
  "delivered",
  "failed",
  "cancelled",
]);

export const discountTypeEnum = pgEnum("discount_type", ["percent", "fixed"]);

export const contentBlockTypeEnum = pgEnum("content_block_type", [
  "announcement",
  "hero",
  "promo_card",
  "room_tile",
  "info_card",
  "faq",
  "page",
]);

export const adminRoleEnum = pgEnum("admin_role", ["owner", "staff"]);

export const stockMovementReasonEnum = pgEnum("stock_movement_reason", [
  "order_paid",
  "manual_adjust",
  "restock",
  "return",
  "correction",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "sms",
  "whatsapp",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
]);
