import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "./adminCatalog";
import { orderItems, products, stockMovements } from "../db/schema";

export type RefundRestockItem = {
  productId: string;
  name: string;
  quantity: number;
};

export type RefundRestockResult = {
  restocked: boolean;
  items: RefundRestockItem[];
};

export async function restockRefundedOrder(
  executor: Executor,
  input: {
    orderId: string;
    adminUserId: string;
    note: string;
  },
): Promise<RefundRestockResult> {
  const [existingReturn] = await executor
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.orderId, input.orderId),
        eq(stockMovements.reason, "return"),
      ),
    )
    .limit(1);

  if (existingReturn) {
    return { restocked: false, items: [] };
  }

  const items = await executor
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, input.orderId));
  const quantityByProduct = new Map<string, number>();

  for (const item of items) {
    if (!item.productId || item.quantity < 1) {
      continue;
    }

    quantityByProduct.set(
      item.productId,
      (quantityByProduct.get(item.productId) ?? 0) + item.quantity,
    );
  }

  const productIds = Array.from(quantityByProduct.keys()).sort();

  if (productIds.length === 0) {
    return { restocked: false, items: [] };
  }

  const lockedProducts = await executor
    .select()
    .from(products)
    .where(inArray(products.id, productIds))
    .orderBy(asc(products.id))
    .for("update");
  const productsById = new Map(
    lockedProducts.map((product) => [product.id, product]),
  );
  const restockedItems: RefundRestockItem[] = [];
  const now = new Date();

  for (const productId of productIds) {
    const product = productsById.get(productId);
    const quantity = quantityByProduct.get(productId) ?? 0;

    if (!product || quantity < 1) {
      continue;
    }

    await executor
      .update(products)
      .set({
        stockQty: product.stockQty + quantity,
        updatedAt: now,
      })
      .where(eq(products.id, product.id));

    await executor.insert(stockMovements).values({
      productId: product.id,
      change: quantity,
      reason: "return",
      orderId: input.orderId,
      adminUserId: input.adminUserId,
      note: input.note,
    });

    restockedItems.push({
      productId: product.id,
      name: product.name,
      quantity,
    });
  }

  return { restocked: restockedItems.length > 0, items: restockedItems };
}
