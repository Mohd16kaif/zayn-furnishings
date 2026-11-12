import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  calculateStockDeduction,
  type StockDeduction,
} from "@zayn/shared";
import { db } from "../db/client";
import {
  auditLog,
  discountCodes,
  orderItems,
  orders,
  payments,
  products,
  stockMovements,
} from "../db/schema";

export const SUCCEEDED_PAYMENT_RAW_EVENT_PREFIX = "pi_succeeded:";

export function succeededPaymentRawEventId(
  paymentIntentId: string,
): string {
  return `${SUCCEEDED_PAYMENT_RAW_EVENT_PREFIX}${paymentIntentId}`;
}

export type PaidTransitionDecision =
  | "mark_paid"
  | "already_processed"
  | "amount_mismatch";

/**
 * Pure idempotency/amount guard used by markOrderPaid. Only a pending order
 * with the exact expected amount may transition to paid.
 */
export function decidePaidTransition(
  orderStatus: string,
  amountReceivedCents: number,
  orderTotalCents: number,
): PaidTransitionDecision {
  if (orderStatus !== "pending") {
    return "already_processed";
  }

  if (amountReceivedCents !== orderTotalCents) {
    return "amount_mismatch";
  }

  return "mark_paid";
}

export type MarkOrderPaidStockChange = {
  productId: string;
  name: string;
  before: number;
  after: number;
  deducted: number;
};

export type MarkOrderPaidShortage = StockDeduction & {
  productId: string | null;
  name: string;
};

export type MarkOrderPaidResult = {
  status:
    | "paid"
    | "processing"
    | "already_processed"
    | "order_not_found"
    | "amount_mismatch"
    | "database_unavailable";
  orderId?: string;
  orderNumber?: string;
  stock: MarkOrderPaidStockChange[];
  shortages: MarkOrderPaidShortage[];
};

export type MarkOrderPaidInput = {
  paymentIntentId: string;
  amountReceivedCents: number;
  currency: string;
};

/**
 * The single idempotent path for a succeeded PaymentIntent. The deterministic
 * payments.raw_event_id makes the real webhook, the reconciliation fallback,
 * and later retries all deduplicate against the same record.
 */
export async function markOrderPaid(
  input: MarkOrderPaidInput,
): Promise<MarkOrderPaidResult> {
  if (!db) {
    return {
      status: "database_unavailable",
      stock: [],
      shortages: [],
    };
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.stripePaymentIntentId, input.paymentIntentId))
      .limit(1)
      .for("update");

    if (!order) {
      return {
        status: "order_not_found" as const,
        stock: [],
        shortages: [],
      };
    }

    const decision = decidePaidTransition(
      order.status,
      input.amountReceivedCents,
      order.totalCents,
    );

    if (decision === "already_processed") {
      return {
        status: "already_processed" as const,
        orderId: order.id,
        orderNumber: order.orderNumber,
        stock: [],
        shortages: [],
      };
    }

    if (decision === "amount_mismatch") {
      return {
        status: "amount_mismatch" as const,
        orderId: order.id,
        orderNumber: order.orderNumber,
        stock: [],
        shortages: [],
      };
    }

    const inserted = await tx
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "stripe",
        providerPaymentId: input.paymentIntentId,
        amountCents: input.amountReceivedCents,
        currency: input.currency,
        status: "succeeded",
        rawEventId: succeededPaymentRawEventId(input.paymentIntentId),
      })
      .onConflictDoNothing({ target: payments.rawEventId })
      .returning({ id: payments.id });

    if (inserted.length === 0) {
      return {
        status: "already_processed" as const,
        orderId: order.id,
        orderNumber: order.orderNumber,
        stock: [],
        shortages: [],
      };
    }

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const itemProductIds = Array.from(
      new Set(
        items
          .map((item) => item.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    ).sort();

    const lockedProducts =
      itemProductIds.length > 0
        ? await tx
            .select()
            .from(products)
            .where(inArray(products.id, itemProductIds))
            .orderBy(asc(products.id))
            .for("update")
        : [];
    const productsById = new Map(
      lockedProducts.map((product) => [product.id, product]),
    );
    const shortages: MarkOrderPaidShortage[] = [];
    const stockChanges: MarkOrderPaidStockChange[] = [];

    for (const item of items) {
      const product = item.productId
        ? productsById.get(item.productId)
        : undefined;

      if (!product) {
        shortages.push({
          productId: item.productId,
          name: item.nameSnapshot,
          requestedQty: item.quantity,
          availableQty: 0,
          appliedQty: 0,
          shortfallQty: item.quantity,
          remainingQty: 0,
        });
        continue;
      }

      const deduction = calculateStockDeduction(
        item.quantity,
        product.stockQty,
      );

      if (deduction.appliedQty > 0) {
        await tx
          .update(products)
          .set({
            stockQty: deduction.remainingQty,
            updatedAt: new Date(),
          })
          .where(eq(products.id, product.id));
      }

      await tx.insert(stockMovements).values({
        productId: product.id,
        change: -deduction.appliedQty,
        reason: "order_paid",
        orderId: order.id,
        note:
          deduction.shortfallQty > 0
            ? `Short by ${deduction.shortfallQty} (requested ${deduction.requestedQty}, available ${deduction.availableQty})`
            : null,
      });

      stockChanges.push({
        productId: product.id,
        name: item.nameSnapshot,
        before: product.stockQty,
        after: deduction.remainingQty,
        deducted: deduction.appliedQty,
      });

      if (deduction.shortfallQty > 0) {
        shortages.push({
          ...deduction,
          productId: product.id,
          name: item.nameSnapshot,
        });
      }
    }

    const now = new Date();

    if (shortages.length > 0) {
      const note = `STOCK SHORTAGE: needs manual review (${shortages
        .map(
          (shortage) =>
            `${shortage.name}: requested ${shortage.requestedQty}, available ${shortage.availableQty}`,
        )
        .join("; ")})`;

      await tx
        .update(orders)
        .set({
          status: "processing",
          paidAt: now,
          internalNotes: order.internalNotes
            ? `${order.internalNotes}\n${note}`
            : note,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));

      await tx.insert(auditLog).values({
        action: "order.stock_shortage",
        entity: "order",
        entityId: order.id,
        details: {
          order_number: order.orderNumber,
          shortfalls: shortages.map((shortage) => ({
            product_id: shortage.productId,
            name: shortage.name,
            requested_qty: shortage.requestedQty,
            available_qty: shortage.availableQty,
            shortfall_qty: shortage.shortfallQty,
          })),
        },
      });
    } else {
      await tx
        .update(orders)
        .set({
          status: "paid",
          paidAt: now,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));
    }

    if (order.discountCode) {
      await tx
        .update(discountCodes)
        .set({
          usedCount: sql`${discountCodes.usedCount} + 1`,
          updatedAt: now,
        })
        .where(eq(discountCodes.code, order.discountCode));
    }

    return {
      status: (shortages.length > 0 ? "processing" : "paid") as
        | "processing"
        | "paid",
      orderId: order.id,
      orderNumber: order.orderNumber,
      stock: stockChanges,
      shortages,
    };
  });
}
