import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { customers } from "./customers";
import { orderStatusEnum } from "./enums";
import { products } from "./products";

export const orderNumberSequence = pgSequence("order_number_seq", {
  startWith: 100001,
});

export const orders = pgTable(
  "orders",
  {
    ...baseColumns(),
    orderNumber: text("order_number")
      .notNull()
      .unique()
      .default(sql`'ZF-' || nextval('order_number_seq')`),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    status: orderStatusEnum("status").default("pending").notNull(),
    subtotalCents: integer("subtotal_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").default(0).notNull(),
    taxCents: integer("tax_cents").default(0).notNull(),
    totalCents: integer("total_cents").default(0).notNull(),
    discountCode: text("discount_code"),
    shippingName: text("shipping_name"),
    shippingLine1: text("shipping_line1"),
    shippingLine2: text("shipping_line2"),
    shippingCity: text("shipping_city"),
    shippingState: text("shipping_state"),
    shippingZip: text("shipping_zip"),
    shippingPhone: text("shipping_phone"),
    customerNotes: text("customer_notes"),
    internalNotes: text("internal_notes"),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_customer_id_idx").on(table.customerId),
    index("orders_email_idx").on(table.email),
    index("orders_status_idx").on(table.status),
    index("orders_created_at_idx").on(table.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    ...baseColumns(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    nameSnapshot: text("name_snapshot").notNull(),
    skuSnapshot: text("sku_snapshot"),
    imageUrlSnapshot: text("image_url_snapshot"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (table) => [
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_product_id_idx").on(table.productId),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
