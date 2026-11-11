import { asc, inArray } from "drizzle-orm";
import { productImages } from "../db/schema";
import type { Executor } from "./adminCatalog";

export async function primaryImagesByProduct(
  executor: Executor,
  productIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (productIds.length === 0) {
    return result;
  }

  const rows = await executor
    .select({
      productId: productImages.productId,
      url: productImages.url,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));

  for (const row of rows) {
    if (!result.has(row.productId)) {
      result.set(row.productId, row.url);
    }
  }

  return result;
}
