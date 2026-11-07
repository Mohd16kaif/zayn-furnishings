import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  char,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

export const customers = pgTable(
  "customers",
  {
    ...baseColumns(),
    authUserId: uuid("auth_user_id").unique(),
    email: text("email").notNull().unique(),
    name: text("name"),
    phone: text("phone"),
    smsOptIn: boolean("sms_opt_in").default(false).notNull(),
    smsOptInAt: timestamp("sms_opt_in_at", { withTimezone: true }),
    marketingEmailOptIn: boolean("marketing_email_opt_in")
      .default(false)
      .notNull(),
  },
  (table) => [
    check(
      "customers_email_lowercase",
      sql`${table.email} = lower(${table.email})`,
    ),
    index("customers_phone_idx").on(table.phone),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    ...baseColumns(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: char("state", { length: 2 }).notNull(),
    zip: text("zip").notNull(),
    phone: text("phone"),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [
    check("addresses_state_two_letters", sql`${table.state} ~ '^[A-Z]{2}$'`),
    check(
      "addresses_zip_format",
      sql`${table.zip} ~ '^[0-9]{5}([0-9]{4})?$'`,
    ),
    index("addresses_customer_id_idx").on(table.customerId),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
