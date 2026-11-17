import {
  dashboardResponseForRole,
  dashboardWindows,
  summarizeDashboardRefundedCents,
  summarizeDashboardSales,
  type AdminDashboardBase,
  type AdminDashboardOwnerMetrics,
} from "@zayn/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db/client";
import {
  customers,
  deliveries,
  orders,
  payments,
  products,
} from "../db/schema";
import { sendError } from "../lib/adminCatalog";
import { requireAdmin } from "../middleware/requireAdmin";
import { STOCK_SHORTAGE_MARKER } from "./adminOrders";

const DASHBOARD_LIST_LIMIT = 10;
const RECENT_ORDER_LIMIT = 5;
const UPCOMING_DELIVERY_DAYS = 7;
const UNSCHEDULED_ORDER_STATUSES = ["paid", "processing"] as const;
const UPCOMING_ORDER_STATUSES = [
  "paid",
  "processing",
  "out_for_delivery",
] as const;
const CLOSED_ORDER_STATUSES = ["pending", "cancelled"] as const;

const EMPTY_OWNER_METRICS: AdminDashboardOwnerMetrics = {
  sales_last_24h: {
    orders_count: 0,
    sales_before_refunds_cents: 0,
  },
  sales_last_7d: {
    orders_count: 0,
    sales_before_refunds_cents: 0,
  },
  refunded_last_24h_cents: 0,
  refunded_last_7d_cents: 0,
};

export const adminDashboardRouter = Router();

adminDashboardRouter.use(requireAdmin);

adminDashboardRouter.get(
  "/dashboard",
  async (req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const now = new Date();
    const windows = dashboardWindows(now);
    const todayStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      ),
    );
    const upcomingEnd = new Date(todayStart);
    upcomingEnd.setUTCDate(
      upcomingEnd.getUTCDate() + UPCOMING_DELIVERY_DAYS,
    );
    const today = todayStart.toISOString().slice(0, 10);
    const upcomingEndDate = upcomingEnd.toISOString().slice(0, 10);

    const lowStockCondition = and(
      eq(products.status, "active"),
      gt(products.stockQty, 0),
      sql`${products.stockQty} <= ${products.lowStockThreshold}`,
    );
    const outOfStockCondition = and(
      eq(products.status, "active"),
      eq(products.stockQty, 0),
    );

    try {
      const [
        newOrderRows,
        stockShortageRows,
        unscheduledRows,
        lowStockRows,
        lowStockTotalRows,
        outOfStockRows,
        outOfStockTotalRows,
        upcomingRows,
        recentRows,
      ] = await Promise.all([
        db
          .select({ value: count() })
          .from(orders)
          .where(eq(orders.status, "paid")),
        db
          .select({ value: count() })
          .from(orders)
          .where(
            ilike(
              orders.internalNotes,
              `%${STOCK_SHORTAGE_MARKER}%`,
            ),
          ),
        db
          .select({ value: count() })
          .from(orders)
          .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
          .where(
            and(
              inArray(orders.status, UNSCHEDULED_ORDER_STATUSES),
              isNull(deliveries.scheduledDate),
            ),
          ),
        db
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            stockQty: products.stockQty,
            threshold: products.lowStockThreshold,
          })
          .from(products)
          .where(lowStockCondition)
          .orderBy(asc(products.stockQty), asc(products.name))
          .limit(DASHBOARD_LIST_LIMIT),
        db
          .select({ value: count() })
          .from(products)
          .where(lowStockCondition),
        db
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            stockQty: products.stockQty,
            threshold: products.lowStockThreshold,
          })
          .from(products)
          .where(outOfStockCondition)
          .orderBy(asc(products.name))
          .limit(DASHBOARD_LIST_LIMIT),
        db
          .select({ value: count() })
          .from(products)
          .where(outOfStockCondition),
        db
          .select({
            orderNumber: orders.orderNumber,
            shippingName: orders.shippingName,
            customerName: customers.name,
            scheduledDate: deliveries.scheduledDate,
            timeWindow: deliveries.timeWindow,
            deliveryStatus: deliveries.status,
          })
          .from(deliveries)
          .innerJoin(orders, eq(deliveries.orderId, orders.id))
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .where(
            and(
              inArray(orders.status, UPCOMING_ORDER_STATUSES),
              gte(deliveries.scheduledDate, today),
              lte(deliveries.scheduledDate, upcomingEndDate),
            ),
          )
          .orderBy(
            asc(deliveries.scheduledDate),
            asc(deliveries.timeWindow),
            asc(orders.orderNumber),
          )
          .limit(DASHBOARD_LIST_LIMIT),
        db
          .select({
            orderNumber: orders.orderNumber,
            shippingName: orders.shippingName,
            customerName: customers.name,
            totalCents: orders.totalCents,
            status: orders.status,
            createdAt: orders.createdAt,
          })
          .from(orders)
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .where(notInArray(orders.status, [...CLOSED_ORDER_STATUSES]))
          .orderBy(desc(orders.createdAt))
          .limit(RECENT_ORDER_LIMIT),
      ]);

      const base: AdminDashboardBase = {
        needs_attention: {
          new_orders_waiting: Number(newOrderRows[0]?.value ?? 0),
          stock_shortage_orders: Number(
            stockShortageRows[0]?.value ?? 0,
          ),
          deliveries_unscheduled: Number(
            unscheduledRows[0]?.value ?? 0,
          ),
        },
        low_stock: {
          items: lowStockRows.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            stock_qty: row.stockQty,
            threshold: row.threshold,
          })),
          total: Number(lowStockTotalRows[0]?.value ?? 0),
        },
        out_of_stock: {
          items: outOfStockRows.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            stock_qty: row.stockQty,
            threshold: row.threshold,
          })),
          total: Number(outOfStockTotalRows[0]?.value ?? 0),
        },
        upcoming_deliveries: upcomingRows.map((row) => ({
          order_number: row.orderNumber,
          customer_name: row.shippingName ?? row.customerName ?? null,
          scheduled_date: row.scheduledDate ?? "",
          time_window: row.timeWindow,
          delivery_status: row.deliveryStatus,
        })),
        recent_orders: recentRows.map((row) => ({
          order_number: row.orderNumber,
          customer_name: row.shippingName ?? row.customerName ?? null,
          total_cents: row.totalCents,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        })),
      };

      let ownerMetrics = EMPTY_OWNER_METRICS;

      if (req.admin?.role === "owner") {
        const [paidOrderRows, refundRows] = await Promise.all([
          db
            .select({
              status: orders.status,
              paidAt: orders.paidAt,
              totalCents: orders.totalCents,
            })
            .from(orders)
            .where(
              and(
                gte(orders.paidAt, windows.last_7d.start),
                lte(orders.paidAt, windows.last_7d.end),
              ),
            ),
          db
            .select({
              status: payments.status,
              createdAt: payments.createdAt,
              amountCents: payments.amountCents,
            })
            .from(payments)
            .where(
              and(
                eq(payments.status, "refunded"),
                gte(payments.createdAt, windows.last_7d.start),
                lte(payments.createdAt, windows.last_7d.end),
              ),
            ),
        ]);

        ownerMetrics = {
          sales_last_24h: summarizeDashboardSales(
            paidOrderRows,
            windows.last_24h,
          ),
          sales_last_7d: summarizeDashboardSales(
            paidOrderRows,
            windows.last_7d,
          ),
          refunded_last_24h_cents: summarizeDashboardRefundedCents(
            refundRows,
            windows.last_24h,
          ),
          refunded_last_7d_cents: summarizeDashboardRefundedCents(
            refundRows,
            windows.last_7d,
          ),
        };
      }

      res.set("Cache-Control", "no-store");
      res.json(
        dashboardResponseForRole(
          req.admin?.role ?? "staff",
          base,
          ownerMetrics,
        ),
      );
    } catch (error) {
      sendError(res, error, "Failed to load dashboard");
    }
  },
);
