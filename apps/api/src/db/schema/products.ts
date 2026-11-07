import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { baseColumns } from "./common";
import { productStatusEnum } from "./enums";

export const products = pgTable(
  "products",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    salePriceCents: integer("sale_price_cents"),
    sku: text("sku").unique(),
    stockQty: integer("stock_qty").default(0).notNull(),
    lowStockThreshold: integer("low_stock_threshold").default(2).notNull(),
    widthIn: numeric("width_in", { precision: 6, scale: 2 }),
    depthIn: numeric("depth_in", { precision: 6, scale: 2 }),
    heightIn: numeric("height_in", { precision: 6, scale: 2 }),
    weightLb: numeric("weight_lb", { precision: 7, scale: 2 }),
    material: text("material"),
    color: text("color"),
    status: productStatusEnum("status").default("draft").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    isFeatured: boolean("is_featured").default(false).notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (table) => [
    check("products_stock_qty_non_negative", sql`${table.stockQty} >= 0`),
    check(
      "products_sale_price_less_than_price",
      sql`${table.salePriceCents} is null or ${table.salePriceCents} < ${table.priceCents}`,
    ),
    index("products_category_id_idx").on(table.categoryId),
    index("products_status_idx").on(table.status),
    index("products_is_featured_idx").on(table.isFeatured),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    ...baseColumns(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [index("product_images_product_id_idx").on(table.productId)],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
