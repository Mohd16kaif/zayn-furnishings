import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./admin";
import { products } from "./products";

export const priceChangeBatches = pgTable(
  "price_change_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    params: jsonb("params").notNull(),
    itemCount: integer("item_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByAdminUserId: uuid("undone_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("price_change_batches_admin_user_id_idx").on(table.adminUserId),
    index("price_change_batches_created_at_idx").on(table.createdAt),
    check(
      "price_change_batches_item_count_positive",
      sql`${table.itemCount} > 0`,
    ),
  ],
);

export const priceChangeItems = pgTable(
  "price_change_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => priceChangeBatches.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    oldPriceCents: integer("old_price_cents").notNull(),
    oldSalePriceCents: integer("old_sale_price_cents"),
    newPriceCents: integer("new_price_cents").notNull(),
    newSalePriceCents: integer("new_sale_price_cents"),
  },
  (table) => [
    index("price_change_items_batch_id_idx").on(table.batchId),
    index("price_change_items_product_id_idx").on(table.productId),
    check(
      "price_change_items_prices_non_negative",
      sql`${table.oldPriceCents} >= 0 and ${table.newPriceCents} >= 0`,
    ),
    check(
      "price_change_items_old_sale_less_than_price",
      sql`${table.oldSalePriceCents} is null or ${table.oldSalePriceCents} < ${table.oldPriceCents}`,
    ),
    check(
      "price_change_items_new_sale_less_than_price",
      sql`${table.newSalePriceCents} is null or ${table.newSalePriceCents} < ${table.newPriceCents}`,
    ),
  ],
);

export type PriceChangeBatch = typeof priceChangeBatches.$inferSelect;
export type NewPriceChangeBatch = typeof priceChangeBatches.$inferInsert;
export type PriceChangeItem = typeof priceChangeItems.$inferSelect;
export type NewPriceChangeItem = typeof priceChangeItems.$inferInsert;
