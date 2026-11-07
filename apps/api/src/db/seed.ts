import { and, count, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { env } from "../config/env";
import { connection, db } from "./client";
import {
  addresses,
  adminUsers,
  auditLog,
  cartItems,
  carts,
  categories,
  contentBlocks,
  customers,
  deliveries,
  deliveryZones,
  discountCodes,
  notificationsLog,
  orderItems,
  orders,
  payments,
  productImages,
  products,
  stockMovements,
} from "./schema";

if (env.NODE_ENV === "production") {
  console.error("Refusing to seed the database when NODE_ENV=production.");
  process.exit(1);
}

if (!db) {
  console.error("DATABASE_URL is required to seed the database.");
  process.exit(1);
}

const database = db;

const topLevelCategories = [
  { name: "Living Room", slug: "living-room", sortOrder: 1 },
  { name: "Bedroom", slug: "bedroom", sortOrder: 2 },
  { name: "Dining Room", slug: "dining-room", sortOrder: 3 },
  { name: "Mattresses", slug: "mattresses", sortOrder: 4 },
  { name: "Rugs and Decor", slug: "rugs-and-decor", sortOrder: 5 },
  { name: "Office", slug: "office", sortOrder: 6 },
  { name: "Outdoor", slug: "outdoor", sortOrder: 7 },
  { name: "Deals", slug: "deals", sortOrder: 8 },
];

const subcategories = [
  { name: "Sofas", slug: "sofas", parentSlug: "living-room", sortOrder: 1 },
  {
    name: "Coffee Tables",
    slug: "coffee-tables",
    parentSlug: "living-room",
    sortOrder: 2,
  },
  { name: "Beds", slug: "beds", parentSlug: "bedroom", sortOrder: 1 },
  { name: "Dressers", slug: "dressers", parentSlug: "bedroom", sortOrder: 2 },
];

const sampleProducts = [
  {
    name: "SAMPLE - Willow Sofa",
    slug: "sample-willow-sofa",
    description:
      "SAMPLE product. A three-seat sofa with a tailored silhouette and removable cushions.",
    priceCents: 129900,
    salePriceCents: 109900,
    sku: "SAMPLE-SOF-001",
    stockQty: 8,
    lowStockThreshold: 2,
    widthIn: "84.00",
    depthIn: "38.00",
    heightIn: "34.00",
    weightLb: "145.50",
    material: "Performance fabric",
    color: "Bone",
    categorySlug: "sofas",
    isFeatured: true,
  },
  {
    name: "SAMPLE - Oak Coffee Table",
    slug: "sample-oak-coffee-table",
    description:
      "SAMPLE product. A rectangular coffee table with a solid oak top and tapered legs.",
    priceCents: 49900,
    salePriceCents: null,
    sku: "SAMPLE-CT-001",
    stockQty: 12,
    lowStockThreshold: 3,
    widthIn: "48.00",
    depthIn: "28.00",
    heightIn: "18.00",
    weightLb: "55.00",
    material: "Solid oak",
    color: "Natural",
    categorySlug: "coffee-tables",
    isFeatured: false,
  },
  {
    name: "SAMPLE - Queen Bed Frame",
    slug: "sample-queen-bed-frame",
    description:
      "SAMPLE product. A queen platform bed frame with a slatted headboard.",
    priceCents: 89900,
    salePriceCents: 79900,
    sku: "SAMPLE-BED-001",
    stockQty: 5,
    lowStockThreshold: 2,
    widthIn: "86.00",
    depthIn: "64.00",
    heightIn: "50.00",
    weightLb: "120.00",
    material: "Oak veneer",
    color: "Walnut",
    categorySlug: "beds",
    isFeatured: true,
  },
  {
    name: "SAMPLE - 6-Drawer Dresser",
    slug: "sample-6-drawer-dresser",
    description:
      "SAMPLE product. A six-drawer dresser with soft-close hardware and metal pulls.",
    priceCents: 74900,
    salePriceCents: null,
    sku: "SAMPLE-DRS-001",
    stockQty: 4,
    lowStockThreshold: 2,
    widthIn: "60.00",
    depthIn: "18.00",
    heightIn: "32.00",
    weightLb: "140.00",
    material: "Engineered wood",
    color: "Charcoal",
    categorySlug: "dressers",
    isFeatured: false,
  },
  {
    name: "SAMPLE - Wool Area Rug 8x10",
    slug: "sample-wool-area-rug-8x10",
    description:
      "SAMPLE product. A hand-tufted wool-blend area rug with a low pile.",
    priceCents: 39900,
    salePriceCents: 34900,
    sku: "SAMPLE-RUG-001",
    stockQty: 10,
    lowStockThreshold: 3,
    widthIn: "120.00",
    depthIn: "96.00",
    heightIn: "0.50",
    weightLb: "28.00",
    material: "Wool blend",
    color: "Sable",
    categorySlug: "rugs-and-decor",
    isFeatured: false,
  },
  {
    name: "SAMPLE - Ergonomic Office Chair",
    slug: "sample-ergonomic-office-chair",
    description:
      "SAMPLE product. A mesh-back task chair with adjustable armrests and lumbar support.",
    priceCents: 29900,
    salePriceCents: 24900,
    sku: "SAMPLE-OFC-001",
    stockQty: 15,
    lowStockThreshold: 4,
    widthIn: "28.00",
    depthIn: "28.00",
    heightIn: "42.00",
    weightLb: "45.00",
    material: "Mesh",
    color: "Graphite",
    categorySlug: "office",
    isFeatured: false,
  },
];

const deliveryZoneRows = [
  {
    name: "Continental US Flat Rate",
    zipStart: "00000",
    zipEnd: "99999",
    feeCents: 9900,
    freeOverCents: 150000,
    isActive: true,
  },
  {
    name: "Northeast Metro",
    zipStart: "10000",
    zipEnd: "19999",
    feeCents: 14900,
    freeOverCents: 250000,
    isActive: true,
  },
  {
    name: "West Coast",
    zipStart: "90000",
    zipEnd: "99999",
    feeCents: 19900,
    freeOverCents: 300000,
    isActive: true,
  },
];

async function countRows(table: PgTable): Promise<number> {
  const [row] = await database.select({ value: count() }).from(table);
  return Number(row?.value ?? 0);
}

async function seed() {
  await database
    .insert(categories)
    .values(topLevelCategories)
    .onConflictDoNothing({ target: categories.slug });

  const topLevelRows = await database
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(
      inArray(
        categories.slug,
        topLevelCategories.map((category) => category.slug),
      ),
    );

  const categoryIdBySlug = new Map(
    topLevelRows.map((row) => [row.slug, row.id]),
  );

  await database
    .insert(categories)
    .values(
      subcategories.map((subcategory) => ({
        name: subcategory.name,
        slug: subcategory.slug,
        parentId: categoryIdBySlug.get(subcategory.parentSlug),
        sortOrder: subcategory.sortOrder,
      })),
    )
    .onConflictDoNothing({ target: categories.slug });

  const categoryRows = await database
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const allCategoryIds = new Map(
    categoryRows.map((row) => [row.slug, row.id]),
  );

  await database
    .insert(products)
    .values(
      sampleProducts.map((product) => ({
        name: product.name,
        slug: product.slug,
        description: product.description,
        priceCents: product.priceCents,
        salePriceCents: product.salePriceCents,
        sku: product.sku,
        stockQty: product.stockQty,
        lowStockThreshold: product.lowStockThreshold,
        widthIn: product.widthIn,
        depthIn: product.depthIn,
        heightIn: product.heightIn,
        weightLb: product.weightLb,
        material: product.material,
        color: product.color,
        status: "active" as const,
        categoryId: allCategoryIds.get(product.categorySlug),
        isFeatured: product.isFeatured,
      })),
    )
    .onConflictDoNothing({ target: products.slug });

  const existingZones = await database
    .select({ name: deliveryZones.name })
    .from(deliveryZones);
  const existingZoneNames = new Set(existingZones.map((zone) => zone.name));
  const zonesToInsert = deliveryZoneRows.filter(
    (zone) => !existingZoneNames.has(zone.name),
  );

  if (zonesToInsert.length > 0) {
    await database.insert(deliveryZones).values(zonesToInsert);
  }

  const announcementTitle = "Free delivery on orders over $1,500";
  const existingAnnouncement = await database
    .select({ id: contentBlocks.id })
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.type, "announcement"),
        eq(contentBlocks.title, announcementTitle),
      ),
    )
    .limit(1);

  if (existingAnnouncement.length === 0) {
    await database.insert(contentBlocks).values({
      type: "announcement",
      title: announcementTitle,
      subtitle: "SAMPLE - replace with your launch announcement",
      body: "SAMPLE announcement content block.",
      buttonText: "Shop now",
      linkUrl: "/collections/all",
      sortOrder: 0,
      isActive: true,
    });
  }

  await database
    .insert(discountCodes)
    .values({
      code: "WELCOME10",
      type: "percent",
      value: 10,
      minOrderCents: 0,
      usageLimit: 1000,
      usedCount: 0,
      isActive: true,
    })
    .onConflictDoNothing({ target: discountCodes.code });

  const tableCounts: Array<[string, PgTable]> = [
    ["categories", categories],
    ["products", products],
    ["product_images", productImages],
    ["customers", customers],
    ["addresses", addresses],
    ["carts", carts],
    ["cart_items", cartItems],
    ["orders", orders],
    ["order_items", orderItems],
    ["payments", payments],
    ["deliveries", deliveries],
    ["delivery_zones", deliveryZones],
    ["discount_codes", discountCodes],
    ["content_blocks", contentBlocks],
    ["admin_users", adminUsers],
    ["stock_movements", stockMovements],
    ["notifications_log", notificationsLog],
    ["audit_log", auditLog],
  ];

  console.log("Seed complete. Row counts:");
  for (const [name, table] of tableCounts) {
    console.log(`  ${name}: ${await countRows(table)}`);
  }
}

seed()
  .catch((error) => {
    console.error(
      "Seed failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
