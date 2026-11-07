import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { customers } from "./customers";
import { products } from "./products";

export const carts = pgTable(
  "carts",
  {
    ...baseColumns(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("carts_customer_id_idx").on(table.customerId),
    index("carts_session_id_idx").on(table.sessionId),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    ...baseColumns(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
    uniqueIndex("cart_items_cart_id_product_id_unique").on(
      table.cartId,
      table.productId,
    ),
    index("cart_items_cart_id_idx").on(table.cartId),
    index("cart_items_product_id_idx").on(table.productId),
  ],
);

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
