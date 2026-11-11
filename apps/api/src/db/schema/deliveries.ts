import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { deliveryMethodEnum, deliveryStatusEnum } from "./enums";
import { orders } from "./orders";

export const deliveries = pgTable(
  "deliveries",
  {
    ...baseColumns(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    method: deliveryMethodEnum("method"),
    status: deliveryStatusEnum("status").default("pending").notNull(),
    scheduledDate: date("scheduled_date"),
    timeWindow: text("time_window"),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier"),
    driverNotes: text("driver_notes"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("deliveries_order_id_idx").on(table.orderId),
    index("deliveries_status_idx").on(table.status),
    index("deliveries_scheduled_date_idx").on(table.scheduledDate),
  ],
);

export const deliveryZones = pgTable(
  "delivery_zones",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    zipStart: char("zip_start", { length: 5 }).notNull(),
    zipEnd: char("zip_end", { length: 5 }).notNull(),
    feeCents: integer("fee_cents").notNull(),
    freeOverCents: integer("free_over_cents"),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    check("delivery_zones_zip_order", sql`${table.zipStart} <= ${table.zipEnd}`),
    index("delivery_zones_zip_range_idx").on(table.zipStart, table.zipEnd),
    index("delivery_zones_is_active_idx").on(table.isActive),
  ],
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
