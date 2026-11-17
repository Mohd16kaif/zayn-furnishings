import type { OrderStatus } from "./orderTransitions";

export type AdminDashboardRole = "owner" | "staff";

export const DASHBOARD_WINDOW_HOURS = {
  last_24h: 24,
  last_7d: 24 * 7,
} as const;

export type AdminDashboardWindowKey = keyof typeof DASHBOARD_WINDOW_HOURS;

export type DashboardWindow = {
  start: Date;
  end: Date;
};

export type DashboardSalesOrder = {
  status: string;
  paidAt: Date | string | null;
  totalCents: number;
};

export type DashboardRefundPayment = {
  status: string;
  createdAt: Date | string;
  amountCents: number;
};

export type DashboardSalesSummary = {
  orders_count: number;
  sales_before_refunds_cents: number;
};

export type AdminDashboardStockItem = {
  id: string;
  name: string;
  sku: string | null;
  stock_qty: number;
  threshold: number;
};

export type AdminDashboardStockGroup = {
  items: AdminDashboardStockItem[];
  total: number;
};

export type AdminDashboardUpcomingDelivery = {
  order_number: string;
  customer_name: string | null;
  scheduled_date: string;
  time_window: string | null;
  delivery_status: string;
};

export type AdminDashboardRecentOrder = {
  order_number: string;
  customer_name: string | null;
  total_cents: number;
  status: OrderStatus;
  created_at: string;
};

export type AdminDashboardNeedsAttention = {
  new_orders_waiting: number;
  stock_shortage_orders: number;
  deliveries_unscheduled: number;
};

export type AdminDashboardBase = {
  needs_attention: AdminDashboardNeedsAttention;
  low_stock: AdminDashboardStockGroup;
  out_of_stock: AdminDashboardStockGroup;
  upcoming_deliveries: AdminDashboardUpcomingDelivery[];
  recent_orders: AdminDashboardRecentOrder[];
};

export type AdminDashboardOwnerMetrics = {
  sales_last_24h: DashboardSalesSummary;
  sales_last_7d: DashboardSalesSummary;
  refunded_last_24h_cents: number;
  refunded_last_7d_cents: number;
};

export type AdminDashboardResponse = AdminDashboardBase &
  Partial<AdminDashboardOwnerMetrics>;

export function rollingDashboardWindow(
  now: Date,
  hours: number,
): DashboardWindow {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

  return { start, end };
}

export function dashboardWindows(
  now: Date,
): Record<AdminDashboardWindowKey, DashboardWindow> {
  return {
    last_24h: rollingDashboardWindow(now, DASHBOARD_WINDOW_HOURS.last_24h),
    last_7d: rollingDashboardWindow(now, DASHBOARD_WINDOW_HOURS.last_7d),
  };
}

function timestampMilliseconds(
  value: Date | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

export function isInDashboardWindow(
  value: Date | string | null | undefined,
  window: DashboardWindow,
): boolean {
  const time = timestampMilliseconds(value);

  if (time === null) {
    return false;
  }

  return (
    time >= window.start.getTime() && time <= window.end.getTime()
  );
}

export function summarizeDashboardSales(
  orders: readonly DashboardSalesOrder[],
  window: DashboardWindow,
): DashboardSalesSummary {
  let ordersCount = 0;
  let salesCents = 0;

  for (const order of orders) {
    if (order.status === "pending" || order.status === "cancelled") {
      continue;
    }

    if (!isInDashboardWindow(order.paidAt, window)) {
      continue;
    }

    ordersCount += 1;
    salesCents += Number.isFinite(order.totalCents)
      ? Math.round(order.totalCents)
      : 0;
  }

  return {
    orders_count: ordersCount,
    sales_before_refunds_cents: salesCents,
  };
}

export function summarizeDashboardRefundedCents(
  payments: readonly DashboardRefundPayment[],
  window: DashboardWindow,
): number {
  let refundedCents = 0;

  for (const payment of payments) {
    if (payment.status !== "refunded") {
      continue;
    }

    if (!isInDashboardWindow(payment.createdAt, window)) {
      continue;
    }

    refundedCents += Number.isFinite(payment.amountCents)
      ? Math.round(payment.amountCents)
      : 0;
  }

  return refundedCents;
}

export function dashboardResponseForRole(
  role: AdminDashboardRole,
  base: AdminDashboardBase,
  ownerMetrics: AdminDashboardOwnerMetrics,
): AdminDashboardResponse {
  if (role === "owner") {
    return { ...base, ...ownerMetrics };
  }

  return { ...base };
}
