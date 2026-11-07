import {
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin";
import { baseColumns } from "./common";

export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details"),
  },
  (table) => [
    index("audit_log_admin_user_id_idx").on(table.adminUserId),
    index("audit_log_entity_idx").on(table.entity),
    index("audit_log_entity_id_idx").on(table.entityId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
