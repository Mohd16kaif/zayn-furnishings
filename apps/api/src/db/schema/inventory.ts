import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin";
import { baseColumns } from "./common";
import { stockMovementReasonEnum } from "./enums";
import { orders } from "./orders";
import { products } from "./products";

export const stockMovements = pgTable(
  "stock_movements",
  {
    ...baseColumns(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    change: integer("change").notNull(),
    reason: stockMovementReasonEnum("reason").notNull(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    note: text("note"),
  },
  (table) => [
    index("stock_movements_product_id_idx").on(table.productId),
    index("stock_movements_order_id_idx").on(table.orderId),
    index("stock_movements_admin_user_id_idx").on(table.adminUserId),
    index("stock_movements_created_at_idx").on(table.createdAt),
  ],
);

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;
