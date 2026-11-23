import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin";

export const adminLoginCodes = pgTable(
  "admin_login_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_login_codes_email_created_at_idx").on(
      table.email,
      table.createdAt,
    ),
    index("admin_login_codes_expires_at_idx").on(table.expiresAt),
    check(
      "admin_login_codes_email_lowercase",
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdIp: text("created_ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_sessions_admin_user_id_idx").on(table.adminUserId),
    index("admin_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type AdminLoginCode = typeof adminLoginCodes.$inferSelect;
export type NewAdminLoginCode = typeof adminLoginCodes.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
