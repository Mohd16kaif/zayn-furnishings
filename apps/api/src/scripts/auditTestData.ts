import { asc, count, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { connection, db } from "../db/client";
import {
  categories,
  contentBlocks,
  customerSessions,
  customers,
  orderItems,
  orders,
  payments,
  phoneVerificationAttempts,
  products,
  stockMovements,
} from "../db/schema";

const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

const PAID_ORDER_STATUSES = [
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
] as const;

function maskPhone(phone: string | null): string | null {
  if (!phone) {
    return null;
  }

  const digits = phone.replace(/\D/g, "");

  return `***${digits.length <= 4 ? digits : digits.slice(-4)}`;
}

async function main(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const orderRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      phone: customers.phone,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .orderBy(asc(orders.createdAt), asc(orders.orderNumber));

  const paymentRows = await db
    .selectDistinct({ orderId: payments.orderId })
    .from(payments);
  const ordersWithPayment = new Set(paymentRows.map((row) => row.orderId));

  const statusCounts = ORDER_STATUSES.reduce<Record<string, number>>(
    (accumulator, status) => {
      accumulator[status] = 0;
      return accumulator;
    },
    {},
  );

  for (const order of orderRows) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
  }

  const customerRows = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .orderBy(asc(customers.createdAt));

  const orderCountRows = await db
    .select({ customerId: orders.customerId, value: count() })
    .from(orders)
    .where(isNotNull(orders.customerId))
    .groupBy(orders.customerId);
  const orderCounts = new Map(
    orderCountRows.map((row) => [row.customerId, Number(row.value)]),
  );

  const sessionCountRows = await db
    .select({ customerId: customerSessions.customerId, value: count() })
    .from(customerSessions)
    .groupBy(customerSessions.customerId);
  const sessionCounts = new Map(
    sessionCountRows.map((row) => [row.customerId, Number(row.value)]),
  );

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      status: products.status,
      stockQty: products.stockQty,
      isFeatured: products.isFeatured,
    })
    .from(products)
    .orderBy(asc(products.name));

  const movementSumRows = await db
    .select({
      productId: stockMovements.productId,
      value: sql<string | null>`sum(${stockMovements.change})`,
    })
    .from(stockMovements)
    .groupBy(stockMovements.productId);
  const movementSums = new Map(
    movementSumRows.map((row) => [row.productId, Number(row.value ?? 0)]),
  );

  const paidUnitRows = await db
    .select({
      productId: orderItems.productId,
      value: sql<string | null>`sum(${orderItems.quantity})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(inArray(orders.status, [...PAID_ORDER_STATUSES]))
    .groupBy(orderItems.productId);
  const paidUnits = new Map(
    paidUnitRows
      .filter((row) => row.productId !== null)
      .map((row) => [row.productId as string, Number(row.value ?? 0)]),
  );

  const productAudit = productRows.map((product) => {
    const movementSum = movementSums.get(product.id) ?? 0;

    return {
      name: product.name,
      sku: product.sku,
      status: product.status,
      stock_qty: product.stockQty,
      stock_movements_sum: movementSum,
      paid_order_units: paidUnits.get(product.id) ?? 0,
      stock_matches_movements: product.stockQty === movementSum,
    };
  });
  const mismatches = productAudit.filter(
    (product) => !product.stock_matches_movements,
  );

  const [sku101] = await db
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .where(eq(products.sku, "101"))
    .limit(1);

  const sku101Movements = sku101
    ? await db
        .select({
          createdAt: stockMovements.createdAt,
          change: stockMovements.change,
          reason: stockMovements.reason,
          orderId: stockMovements.orderId,
          note: stockMovements.note,
        })
        .from(stockMovements)
        .where(eq(stockMovements.productId, sku101.id))
        .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
    : [];

  const sampleContentBlocks = await db
    .select({
      id: contentBlocks.id,
      type: contentBlocks.type,
      title: contentBlocks.title,
      isActive: contentBlocks.isActive,
      linkUrl: contentBlocks.linkUrl,
    })
    .from(contentBlocks)
    .where(
      sql`lower(coalesce(${contentBlocks.title}, '')) like '%sample%'
        or lower(coalesce(${contentBlocks.subtitle}, '')) like '%sample%'
        or lower(coalesce(${contentBlocks.body}, '')) like '%sample%'`,
    )
    .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id));

  const collectionsAllBlocks = await db
    .select({
      id: contentBlocks.id,
      type: contentBlocks.type,
      title: contentBlocks.title,
      isActive: contentBlocks.isActive,
      linkUrl: contentBlocks.linkUrl,
    })
    .from(contentBlocks)
    .where(eq(contentBlocks.linkUrl, "/collections/all"))
    .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id));

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(asc(categories.name));

  const categoryProductRows = await db
    .select({ categoryId: products.categoryId, value: count() })
    .from(products)
    .where(isNotNull(products.categoryId))
    .groupBy(products.categoryId);
  const categoryProductCounts = new Map(
    categoryProductRows
      .filter((row) => row.categoryId !== null)
      .map((row) => [row.categoryId as string, Number(row.value)]),
  );

  const categoriesWithCounts = categoryRows.map((category) => ({
    ...category,
    product_count: categoryProductCounts.get(category.id) ?? 0,
  }));

  const woodenChairCategories = categoriesWithCounts.filter(
    (category) => category.name.trim().toLowerCase() === "wooden chair",
  );

  const siblingGroups = new Map<string, typeof categoriesWithCounts>();
  for (const category of categoriesWithCounts) {
    const key = `${category.parentId ?? "root"}|${category.sortOrder}`;
    const group = siblingGroups.get(key) ?? [];
    group.push(category);
    siblingGroups.set(key, group);
  }

  const duplicateSortOrders = Array.from(siblingGroups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const separator = key.lastIndexOf("|");

      return {
        parent_id: key.slice(0, separator) === "root" ? null : key.slice(0, separator),
        sort_order: Number(key.slice(separator + 1)),
        categories: group.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          product_count: category.product_count,
        })),
      };
    })
    .sort((left, right) => {
      const leftParent = left.parent_id ?? "";
      const rightParent = right.parent_id ?? "";

      return (
        leftParent.localeCompare(rightParent) ||
        left.sort_order - right.sort_order
      );
    });

  const sampleProducts = await db
    .select({
      name: products.name,
      sku: products.sku,
      stockQty: products.stockQty,
      status: products.status,
      isFeatured: products.isFeatured,
    })
    .from(products)
    .where(ilike(products.name, "SAMPLE -%"))
    .orderBy(asc(products.name));

  const [phoneAttemptCount] = await db
    .select({ value: count() })
    .from(phoneVerificationAttempts);
  const [sessionCount] = await db
    .select({ value: count() })
    .from(customerSessions);

  console.log(
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        orders: {
          total: orderRows.length,
          counts_by_status: statusCounts,
          rows: orderRows.map((order) => ({
            order_number: order.orderNumber,
            status: order.status,
            total_cents: order.totalCents,
            created_at: order.createdAt.toISOString(),
            customer_phone_last4: maskPhone(order.phone),
            has_payment_row: ordersWithPayment.has(order.id) ? "Y" : "N",
            stripe_payment_intent_present: order.stripePaymentIntentId
              ? "Y"
              : "N",
          })),
        },
        customers: {
          total: customerRows.length,
          rows: customerRows.map((customer) => ({
            phone_last4: maskPhone(customer.phone),
            order_count: orderCounts.get(customer.id) ?? 0,
            session_count: sessionCounts.get(customer.id) ?? 0,
          })),
        },
        products: {
          total: productRows.length,
          rows: productAudit,
          mismatches,
        },
        sku_101: {
          product: sku101
            ? { name: sku101.name, sku: sku101.sku }
            : null,
          movements: sku101Movements.map((movement) => ({
            created_at: movement.createdAt.toISOString(),
            change: movement.change,
            reason: movement.reason,
            order_id: movement.orderId,
            note: movement.note,
          })),
        },
        content_blocks: {
          sample_keyword: sampleContentBlocks.map((block) => ({
            id: block.id,
            type: block.type,
            title: block.title,
            is_active: block.isActive,
            link_url: block.linkUrl,
          })),
          collections_all: collectionsAllBlocks.map((block) => ({
            id: block.id,
            type: block.type,
            title: block.title,
            is_active: block.isActive,
            link_url: block.linkUrl,
          })),
        },
        categories: {
          total: categoriesWithCounts.length,
          wooden_chair: woodenChairCategories,
          duplicate_sort_orders: duplicateSortOrders,
        },
        sample_products: sampleProducts.map((product) => ({
          name: product.name,
          sku: product.sku,
          stock_qty: product.stockQty,
          status: product.status,
          is_featured: product.isFeatured,
        })),
        verification_tables: {
          phone_verification_attempts: Number(phoneAttemptCount?.value ?? 0),
          customer_sessions: Number(sessionCount?.value ?? 0),
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Test data audit failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
