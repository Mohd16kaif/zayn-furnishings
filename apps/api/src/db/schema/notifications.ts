import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { customers } from "./customers";
import { notificationChannelEnum, notificationStatusEnum } from "./enums";
import { orders } from "./orders";

export const notificationsLog = pgTable(
  "notifications_log",
  {
    ...baseColumns(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    channel: notificationChannelEnum("channel").notNull(),
    template: text("template"),
    toAddress: text("to_address"),
    dedupeKey: text("dedupe_key").unique(),
    status: notificationStatusEnum("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    index("notifications_log_customer_id_idx").on(table.customerId),
    index("notifications_log_order_id_idx").on(table.orderId),
    index("notifications_log_status_idx").on(table.status),
    index("notifications_log_channel_idx").on(table.channel),
  ],
);

export type NotificationLog = typeof notificationsLog.$inferSelect;
export type NewNotificationLog = typeof notificationsLog.$inferInsert;
