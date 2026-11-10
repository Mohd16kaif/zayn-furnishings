import { count, eq } from "drizzle-orm";
import { connection, db } from "../db/client";
import { categories, products } from "../db/schema";

type ChildSeed = {
  name: string;
  slug: string;
};

type TopLevelSeed = {
  name: string;
  slug: string;
  children: ChildSeed[];
};

const TOP_LEVEL_CATEGORIES: TopLevelSeed[] = [
  {
    name: "Living Room",
    slug: "living-room",
    children: [
      { name: "Sofas", slug: "sofas" },
      { name: "Loveseats", slug: "loveseats" },
      { name: "Sectionals", slug: "sectionals" },
      { name: "Sleeper Sofas", slug: "sleeper-sofas" },
      { name: "Reclining Furniture", slug: "reclining-furniture" },
      { name: "Leather Seating", slug: "leather-seating" },
      { name: "Modular Seating", slug: "modular-seating" },
      { name: "Accent Chairs", slug: "accent-chairs" },
      { name: "Ottomans", slug: "ottomans" },
      { name: "Coffee Tables", slug: "coffee-tables" },
      { name: "End Tables", slug: "end-tables" },
      { name: "TV Stands", slug: "tv-stands" },
      { name: "Living Room Sets", slug: "living-room-sets" },
    ],
  },
  {
    name: "Bedroom",
    slug: "bedroom",
    children: [
      { name: "Beds", slug: "beds" },
      { name: "Bedroom Sets", slug: "bedroom-sets" },
      { name: "Headboards", slug: "headboards" },
      { name: "Dressers", slug: "dressers" },
      { name: "Nightstands", slug: "nightstands" },
      { name: "Bedroom Vanities", slug: "bedroom-vanities" },
      { name: "Bedroom Storage", slug: "bedroom-storage" },
      { name: "Bedding", slug: "bedding" },
    ],
  },
  {
    name: "Dining Room",
    slug: "dining-room",
    children: [
      { name: "Dining Sets", slug: "dining-sets" },
      { name: "Dining Tables", slug: "dining-tables" },
      { name: "Extendable Tables", slug: "extendable-tables" },
      { name: "Dining Chairs", slug: "dining-chairs" },
      { name: "Bar Stools", slug: "bar-stools" },
      { name: "Dining Benches", slug: "dining-benches" },
      { name: "Buffets and Sideboards", slug: "buffets-and-sideboards" },
      { name: "Bar Furniture", slug: "bar-furniture" },
    ],
  },
  {
    name: "Mattresses",
    slug: "mattresses",
    children: [
      { name: "Mattress Sets", slug: "mattress-sets" },
      { name: "Twin Mattresses", slug: "twin-mattresses" },
      { name: "Full Mattresses", slug: "full-mattresses" },
      { name: "Queen Mattresses", slug: "queen-mattresses" },
      { name: "King Mattresses", slug: "king-mattresses" },
      { name: "Memory Foam", slug: "memory-foam" },
      { name: "Hybrid Mattresses", slug: "hybrid-mattresses" },
      { name: "Innerspring", slug: "innerspring" },
      { name: "Adjustable Bases", slug: "adjustable-bases" },
      { name: "Pillows and Protectors", slug: "pillows-and-protectors" },
    ],
  },
  {
    name: "Rugs and Decor",
    slug: "rugs-and-decor",
    children: [
      { name: "Area Rugs", slug: "area-rugs" },
      { name: "Mirrors", slug: "mirrors" },
      { name: "Wall Art", slug: "wall-art" },
      { name: "Wall Decor", slug: "wall-decor" },
      { name: "Lighting", slug: "lighting" },
      { name: "Throw Pillows and Blankets", slug: "throw-pillows-and-blankets" },
      { name: "Window Treatments", slug: "window-treatments" },
      { name: "Vases and Accents", slug: "vases-and-accents" },
      { name: "Bath", slug: "bath" },
      { name: "Seasonal Decor", slug: "seasonal-decor" },
    ],
  },
  {
    name: "Office",
    slug: "office",
    children: [
      { name: "Desks", slug: "desks" },
      { name: "Bookcases", slug: "bookcases" },
      { name: "Office Chairs", slug: "office-chairs" },
      { name: "Office Sets", slug: "office-sets" },
      { name: "Office Storage", slug: "office-storage" },
      { name: "Gaming Furniture", slug: "gaming-furniture" },
    ],
  },
  {
    name: "Outdoor",
    slug: "outdoor",
    children: [
      { name: "Outdoor Lounge", slug: "outdoor-lounge" },
      { name: "Outdoor Dining", slug: "outdoor-dining" },
      { name: "Outdoor Bar", slug: "outdoor-bar" },
      { name: "Patio Heating", slug: "patio-heating" },
      { name: "Outdoor Accessories", slug: "outdoor-accessories" },
    ],
  },
  {
    name: "Baby and Kids",
    slug: "baby-and-kids",
    children: [
      { name: "Kids Bedroom", slug: "kids-bedroom" },
      { name: "Kids Furniture", slug: "kids-furniture" },
      { name: "Playroom", slug: "playroom" },
      { name: "Kids Bedding", slug: "kids-bedding" },
      { name: "Kids Decor", slug: "kids-decor" },
      { name: "Nursery Furniture", slug: "nursery-furniture" },
      { name: "Baby and Toddler Gear", slug: "baby-and-toddler-gear" },
    ],
  },
];

type CategoryRow = typeof categories.$inferSelect;

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findMatchingCategory(
  rows: CategoryRow[],
  parentId: string | null,
  name: string,
  slug: string,
): CategoryRow | undefined {
  return rows.find(
    (row) =>
      row.parentId === parentId &&
      (row.slug === slug || sameName(row.name, name)),
  );
}

function slugExists(rows: CategoryRow[], slug: string): boolean {
  return rows.some((row) => row.slug === slug);
}

function uniqueChildSlug(
  rows: CategoryRow[],
  baseSlug: string,
  parentSlug: string,
): string {
  let candidate = baseSlug;

  if (slugExists(rows, candidate)) {
    candidate = `${baseSlug}-${parentSlug}`;
  }

  let suffix = 2;

  while (slugExists(rows, candidate)) {
    candidate = `${baseSlug}-${parentSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function seedCategories(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required to seed categories.");
    process.exitCode = 1;
    return;
  }

  const confirmed = process.argv.includes("--confirm");

  if (process.env.NODE_ENV === "production" && !confirmed) {
    console.error(
      "Refusing to seed categories in production without the --confirm flag.",
    );
    process.exitCode = 1;
    return;
  }

  const rows: CategoryRow[] = await db.select().from(categories);
  let created = 0;
  let skipped = 0;
  let deactivated = 0;

  for (const [topIndex, topLevel] of TOP_LEVEL_CATEGORIES.entries()) {
    let parent = findMatchingCategory(
      rows,
      null,
      topLevel.name,
      topLevel.slug,
    );

    if (parent) {
      skipped += 1;
    } else if (slugExists(rows, topLevel.slug)) {
      console.warn(
        `Skipping ${topLevel.name}: slug "${topLevel.slug}" is already used by another category.`,
      );
      skipped += 1;
      continue;
    } else {
      const [inserted] = await db
        .insert(categories)
        .values({
          name: topLevel.name,
          slug: topLevel.slug,
          parentId: null,
          description: null,
          sortOrder: topIndex + 1,
          isActive: true,
        })
        .returning();

      rows.push(inserted);
      parent = inserted;
      created += 1;
    }

    for (const [childIndex, child] of topLevel.children.entries()) {
      const existing = findMatchingCategory(
        rows,
        parent.id,
        child.name,
        child.slug,
      );

      if (existing) {
        skipped += 1;
        continue;
      }

      const slug = uniqueChildSlug(rows, child.slug, parent.slug);
      const [inserted] = await db
        .insert(categories)
        .values({
          name: child.name,
          slug,
          parentId: parent.id,
          description: null,
          sortOrder: childIndex + 1,
          isActive: true,
        })
        .returning();

      rows.push(inserted);
      created += 1;
    }
  }

  const deals = findMatchingCategory(rows, null, "Deals", "deals");

  if (deals) {
    const [result] = await db
      .select({ value: count() })
      .from(products)
      .where(eq(products.categoryId, deals.id));

    if (Number(result?.value ?? 0) === 0 && deals.isActive) {
      await db
        .update(categories)
        .set({ isActive: false })
        .where(eq(categories.id, deals.id));

      deactivated += 1;
    }
  }

  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Deactivated: ${deactivated}`);
}

seedCategories()
  .catch((error) => {
    console.error(
      "Category seed failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
