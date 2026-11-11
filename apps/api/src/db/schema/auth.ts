import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { phoneVerificationKindEnum } from "./enums";

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("customer_sessions_customer_id_idx").on(table.customerId),
    index("customer_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const phoneVerificationAttempts = pgTable(
  "phone_verification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    ip: text("ip"),
    kind: phoneVerificationKindEnum("kind").notNull(),
    success: boolean("success").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("phone_verification_attempts_phone_created_idx").on(
      table.phone,
      table.createdAt,
    ),
    index("phone_verification_attempts_ip_created_idx").on(
      table.ip,
      table.createdAt,
    ),
  ],
);

export type CustomerSession = typeof customerSessions.$inferSelect;
export type NewCustomerSession = typeof customerSessions.$inferInsert;
export type PhoneVerificationAttempt =
  typeof phoneVerificationAttempts.$inferSelect;
export type NewPhoneVerificationAttempt =
  typeof phoneVerificationAttempts.$inferInsert;
