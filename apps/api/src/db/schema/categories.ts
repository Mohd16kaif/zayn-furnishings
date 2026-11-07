import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

export const categories = pgTable(
  "categories",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => categories.id,
      { onDelete: "set null" },
    ),
    imageUrl: text("image_url"),
    description: text("description"),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (table) => [
    index("categories_parent_id_idx").on(table.parentId),
    index("categories_is_active_idx").on(table.isActive),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
