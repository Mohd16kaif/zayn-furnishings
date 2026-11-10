import { sql } from "drizzle-orm";
import { connection, db } from "../db/client";
import { categories } from "../db/schema";

/**
 * One-off cleanup for the starter category template copy.
 *
 * Only rows whose description exactly matches the template pattern
 * "Pieces and essentials in the <category> category." are cleared.
 * Owner-written descriptions are never touched.
 */
async function cleanCategoryDescriptions(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required to clean category descriptions.");
    process.exitCode = 1;
    return;
  }

  const updated = await db
    .update(categories)
    .set({ description: null })
    .where(
      sql`${categories.description} LIKE 'Pieces and essentials in the % category.'`,
    )
    .returning({ id: categories.id });

  console.log(`Cleaned descriptions: ${updated.length}`);
}

cleanCategoryDescriptions()
  .catch((error) => {
    console.error(
      "Category description cleanup failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
