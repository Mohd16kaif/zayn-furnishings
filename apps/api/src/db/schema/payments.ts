import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { paymentStatusEnum } from "./enums";
import { orders } from "./orders";

export const payments = pgTable(
  "payments",
  {
    ...baseColumns(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").default("stripe").notNull(),
    providerPaymentId: text("provider_payment_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("usd").notNull(),
    status: paymentStatusEnum("status").default("pending").notNull(),
    rawEventId: text("raw_event_id").unique(),
  },
  (table) => [
    index("payments_order_id_idx").on(table.orderId),
    index("payments_provider_payment_id_idx").on(table.providerPaymentId),
    index("payments_status_idx").on(table.status),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
