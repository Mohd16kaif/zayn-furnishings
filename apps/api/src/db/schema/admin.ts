import {
  boolean,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { adminRoleEnum } from "./enums";

export const adminUsers = pgTable(
  "admin_users",
  {
    ...baseColumns(),
    authUserId: uuid("auth_user_id").notNull().unique(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: adminRoleEnum("role").default("staff").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [index("admin_users_is_active_idx").on(table.isActive)],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
