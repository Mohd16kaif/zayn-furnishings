import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { connection, db } from "../db/client";
import { notificationsLog, orders } from "../db/schema";
import {
  ORDER_CONFIRMATION_TEMPLATE,
  dispatchNotification,
  enqueueNotification,
  maskEmailAddress,
  truncateError,
} from "../emails/outbox";

const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const SWEEP_DAYS = 7;
const PAID_OR_LATER_STATUSES = [
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
  "refunded",
  "partially_refunded",
] as const;

async function main(): Promise<void> {
  if (!db) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - RETRY_AFTER_MS);
  const sweepCutoff = new Date(
    now.getTime() - SWEEP_DAYS * 24 * 60 * 60 * 1000,
  );

  const retryRows = await db
    .select({
      id: notificationsLog.id,
      toAddress: notificationsLog.toAddress,
      status: notificationsLog.status,
      attempts: notificationsLog.attempts,
      createdAt: notificationsLog.createdAt,
    })
    .from(notificationsLog)
    .where(
      and(
        inArray(notificationsLog.status, ["queued", "failed"]),
        lt(notificationsLog.attempts, MAX_ATTEMPTS),
        lt(notificationsLog.createdAt, retryCutoff),
      ),
    )
    .orderBy(notificationsLog.createdAt);

  const retry = {
    found: retryRows.length,
    sent: 0,
    logged: 0,
    failed: 0,
    skipped: 0,
  };

  if (!dryRun) {
    for (const row of retryRows) {
      const result = await dispatchNotification(row.id);

      if (result.status === "sent") {
        retry.sent += 1;
      } else if (result.status === "logged") {
        retry.logged += 1;
      } else if (result.status === "failed") {
        retry.failed += 1;
      } else {
        retry.skipped += 1;
      }
    }
  }

  const paidOrders = await db
    .select({
      id: orders.id,
      email: orders.email,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.status, PAID_OR_LATER_STATUSES),
        gte(orders.paidAt, sweepCutoff),
      ),
    )
    .orderBy(orders.createdAt);

  const existingRows = await db
    .select({ orderId: notificationsLog.orderId })
    .from(notificationsLog)
    .where(eq(notificationsLog.template, ORDER_CONFIRMATION_TEMPLATE));
  const existingOrderIds = new Set(
    existingRows
      .map((row) => row.orderId)
      .filter((value): value is string => Boolean(value)),
  );
  const missingOrders = paidOrders.filter(
    (order) => !existingOrderIds.has(order.id),
  );

  const sweep = {
    ordersFound: missingOrders.length,
    enqueued: 0,
    sent: 0,
    logged: 0,
    failed: 0,
    skipped: 0,
  };

  if (!dryRun) {
    for (const order of missingOrders) {
      const enqueued = await enqueueNotification({
        template: ORDER_CONFIRMATION_TEMPLATE,
        orderId: order.id,
        toAddress: order.email.trim(),
        dedupeKey: `order_confirmation:${order.id}`,
      });

      if (!enqueued.inserted || !enqueued.id) {
        continue;
      }

      sweep.enqueued += 1;

      const result = await dispatchNotification(enqueued.id);

      if (result.status === "sent") {
        sweep.sent += 1;
      } else if (result.status === "logged") {
        sweep.logged += 1;
      } else if (result.status === "failed") {
        sweep.failed += 1;
      } else {
        sweep.skipped += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dry_run: dryRun,
        retry: {
          ...retry,
          addresses: retryRows.map((row) =>
            row.toAddress ? maskEmailAddress(row.toAddress) : null,
          ),
        },
        sweep: {
          ...sweep,
          addresses: missingOrders.map((order) =>
            maskEmailAddress(order.email),
          ),
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
      "Notification retry failed:",
      truncateError(
        error instanceof Error ? error.message : "Unknown email error.",
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection?.end();
  });
