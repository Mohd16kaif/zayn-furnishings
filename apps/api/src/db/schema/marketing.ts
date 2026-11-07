import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";
import { contentBlockTypeEnum, discountTypeEnum } from "./enums";

export const discountCodes = pgTable(
  "discount_codes",
  {
    ...baseColumns(),
    code: text("code").notNull().unique(),
    type: discountTypeEnum("type").notNull(),
    value: integer("value").notNull(),
    minOrderCents: integer("min_order_cents").default(0).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    check(
      "discount_codes_code_uppercase",
      sql`${table.code} = upper(${table.code})`,
    ),
    index("discount_codes_is_active_idx").on(table.isActive),
  ],
);

export const contentBlocks = pgTable(
  "content_blocks",
  {
    ...baseColumns(),
    type: contentBlockTypeEnum("type").notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    body: text("body"),
    imageUrl: text("image_url"),
    buttonText: text("button_text"),
    linkUrl: text("link_url"),
    sortOrder: integer("sort_order").default(0).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    index("content_blocks_type_idx").on(table.type),
    index("content_blocks_is_active_idx").on(table.isActive),
    index("content_blocks_sort_order_idx").on(table.sortOrder),
  ],
);

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
export type ContentBlock = typeof contentBlocks.$inferSelect;
export type NewContentBlock = typeof contentBlocks.$inferInsert;
