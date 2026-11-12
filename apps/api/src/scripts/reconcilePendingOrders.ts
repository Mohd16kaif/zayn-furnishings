import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { connection, db } from "../db/client";
import { orderItems, orders, products } from "../db/schema";
import { reconcileOrderPayment } from "../lib/reconcileOrderPayment";

type StockSnapshot = {
  product_id: string | null;
  name: string;
  quantity: number;
  stock: number | null;
};

async function stockSnapshot(orderId: string): Promise<StockSnapshot[]> {
  if (!db) {
    return [];
  }

  const items = await db
    .select({
      productId: orderItems.productId,
      name: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const productIds = Array.from(
    new Set(items.map((item) => item.productId).filter(Boolean)),
  ) as string[];
  const productRows =
    productIds.length > 0
      ? await db
          .select({
            id: products.id,
            stockQty: products.stockQty,
          })
          .from(products)
          .where(inArray(products.id, productIds))
      : [];
  const stockById = new Map(
    productRows.map((product) => [product.id, product.stockQty]),
  );

  return items.map((item) => ({
    product_id: item.productId,
    name: item.name,
    quantity: item.quantity,
    stock: item.productId ? stockById.get(item.productId) ?? null : null,
  }));
}

async function main(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  const pendingOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      totalCents: orders.totalCents,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        isNotNull(orders.stripePaymentIntentId),
      ),
    )
    .orderBy(orders.createdAt);

  if (pendingOrders.length === 0) {
    console.log("No pending orders with a PaymentIntent found.");
    return;
  }

  for (const order of pendingOrders) {
    const reconciliation = await reconcileOrderPayment(order, {
      enforceAge: false,
      enforceLookupLimit: false,
      dryRun,
    });

    if (reconciliation.status === "dry_run_would_mark") {
      console.log(
        JSON.stringify({
          mode: "dry-run",
          order: order.orderNumber,
          result: reconciliation.status,
          payment_intent_status: reconciliation.paymentIntentStatus,
          stock_before: await stockSnapshot(order.id),
        }),
      );
      continue;
    }

    if (reconciliation.status === "reconciled") {
      console.log(
        JSON.stringify({
          mode: dryRun ? "dry-run" : "real",
          order: order.orderNumber,
          result: reconciliation.result.status,
          payment_intent_status: reconciliation.paymentIntentStatus,
          stock: reconciliation.result.stock,
          shortages: reconciliation.result.shortages.map((shortage) => ({
            product_id: shortage.productId,
            name: shortage.name,
            requested_qty: shortage.requestedQty,
            available_qty: shortage.availableQty,
            shortfall_qty: shortage.shortfallQty,
          })),
        }),
      );
      continue;
    }

    console.log(
      JSON.stringify({
        mode: dryRun ? "dry-run" : "real",
        order: order.orderNumber,
        result: reconciliation.status,
        ...("paymentIntentStatus" in reconciliation
          ? { payment_intent_status: reconciliation.paymentIntentStatus }
          : {}),
        ...("error" in reconciliation
          ? { error: reconciliation.error }
          : {}),
        stock_before: await stockSnapshot(order.id),
      }),
    );
  }
}

main()
  .catch((error) => {
    console.error(
      "Pending order reconciliation failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
