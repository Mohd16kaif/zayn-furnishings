"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminDashboardResponse,
  AdminDashboardStockGroup,
  AdminDashboardUpcomingDelivery,
  AdminDashboardRecentOrder,
} from "@zayn/shared";
import { adminFetch, AdminApiError } from "@/lib/adminApi";
import {
  deliveryStatusLabel,
  formatAdminDateTime,
  orderStatusBadgeClass,
  orderStatusLabel,
} from "@/lib/adminOrderLabels";
import { formatCents } from "@/lib/money";

type LoadStatus = "loading" | "ready" | "error";

const CARD_CLASS =
  "rounded-2xl border border-stone-200 bg-white p-5 shadow-sm";

function formatDeliveryDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${CARD_CLASS} min-w-0`}>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">
        {value}
      </p>
    </div>
  );
}

function StockTable({
  title,
  group,
  emptyLabel,
}: {
  title: string;
  group: AdminDashboardStockGroup;
  emptyLabel: string;
}) {
  return (
    <section className={`${CARD_CLASS} min-w-0`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        <span className="text-xs text-stone-500">
          {group.total} {group.total === 1 ? "product" : "products"}
        </span>
      </div>

      {group.items.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[420px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="pb-2 pr-4 font-medium">Product</th>
                <th className="pb-2 pr-4 font-medium">SKU</th>
                <th className="pb-2 pr-4 font-medium">Stock</th>
                <th className="pb-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {group.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 pr-4 font-medium text-stone-900">
                    {item.name}
                  </td>
                  <td className="py-3 pr-4 text-stone-600">
                    {item.sku ?? "No SKU"}
                  </td>
                  <td className="py-3 pr-4 text-stone-600">
                    {item.stock_qty}
                  </td>
                  <td className="py-3 text-right">
                    <Link
                      className="text-xs font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900"
                      href={`/admin/products/${item.id}`}
                    >
                      Edit product
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {group.total > group.items.length ? (
        <p className="mt-3 text-xs text-stone-500">
          Showing the first {group.items.length} of {group.total}.
        </p>
      ) : null}
    </section>
  );
}

function UpcomingDeliveryRow({
  delivery,
}: {
  delivery: AdminDashboardUpcomingDelivery;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          className="text-sm font-medium text-stone-900 underline underline-offset-2 hover:text-stone-700"
          href={`/admin/orders/${delivery.order_number}`}
        >
          {delivery.order_number}
        </Link>
        <p className="mt-1 break-words text-xs text-stone-500">
          {delivery.customer_name ?? "Customer name unavailable"}
        </p>
      </div>
      <div className="text-left text-xs text-stone-600 sm:text-right">
        <p className="font-medium text-stone-900">
          {formatDeliveryDay(delivery.scheduled_date)}
        </p>
        <p>{delivery.time_window ?? "Time not set"}</p>
        <p className="text-stone-500">
          {deliveryStatusLabel(delivery.delivery_status)}
        </p>
      </div>
    </li>
  );
}

function RecentOrderRow({
  order,
}: {
  order: AdminDashboardRecentOrder;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          className="text-sm font-medium text-stone-900 underline underline-offset-2 hover:text-stone-700"
          href={`/admin/orders/${order.order_number}`}
        >
          {order.order_number}
        </Link>
        <p className="mt-1 break-words text-xs text-stone-500">
          {order.customer_name ?? "Customer name unavailable"}
        </p>
        <p className="mt-1 text-xs text-stone-500">
          {formatAdminDateTime(order.created_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${orderStatusBadgeClass(
            order.status,
          )}`}
        >
          {orderStatusLabel(order.status)}
        </span>
        <span className="text-sm font-medium text-stone-900">
          {formatCents(order.total_cents)}
        </span>
      </div>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className={`${CARD_CLASS} h-28 animate-pulse bg-stone-100`}
          />
        ))}
      </div>
      <div className={`${CARD_CLASS} h-48 animate-pulse bg-stone-100`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className={`${CARD_CLASS} h-64 animate-pulse bg-stone-100`} />
        <div className={`${CARD_CLASS} h-64 animate-pulse bg-stone-100`} />
      </div>
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async (initial: boolean) => {
    if (initial) {
      setStatus("loading");
    } else {
      setRefreshing(true);
    }

    setError("");

    try {
      const response = await adminFetch<AdminDashboardResponse>(
        "/admin/dashboard",
      );

      setData(response);
      setRefreshedAt(new Date());
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof AdminApiError && loadError.status === 403
          ? "You do not have permission to view the dashboard."
          : loadError instanceof Error
            ? loadError.message
            : "Unable to load the dashboard.",
      );

      if (initial) {
        setStatus("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();

      if (!cancelled) {
        await loadDashboard(true);
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const refreshLabel = refreshedAt
    ? `Last refreshed ${formatAdminDateTime(refreshedAt.toISOString())}`
    : "Not refreshed yet";

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          A quick look at orders, stock, deliveries, and recent activity.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-stone-500" aria-live="polite">
          {status === "loading" ? "Loading dashboard..." : refreshLabel}
        </p>
        <button
          type="button"
          onClick={() => void loadDashboard(data === null)}
          disabled={refreshing || status === "loading"}
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );

  if (status === "loading") {
    return (
      <div>
        {header}
        <div className="mt-8">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div>
        {header}
        <section className={`${CARD_CLASS} mt-8`}>
          <h2 className="text-lg font-semibold text-stone-900">
            We could not load the dashboard
          </h2>
          <p className="mt-2 text-sm text-stone-600" role="alert">
            {error ||
              "Please check your connection and try again in a moment."}
          </p>
          <button
            type="button"
            onClick={() => void loadDashboard(true)}
            className="mt-5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
          >
            Retry
          </button>
        </section>
      </div>
    );
  }

  const owner = Boolean(
    data.sales_last_24h &&
      data.sales_last_7d &&
      data.refunded_last_24h_cents !== undefined &&
      data.refunded_last_7d_cents !== undefined,
  );
  const attentionTotal =
    data.needs_attention.new_orders_waiting +
    data.needs_attention.stock_shortage_orders +
    data.needs_attention.deliveries_unscheduled;

  return (
    <div>
      {header}

      {error ? (
        <div
          className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void loadDashboard(false)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {owner ? (
        <section className="mt-8" aria-label="Sales summary">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label="Orders, last 24 hours"
              value={String(data.sales_last_24h?.orders_count ?? 0)}
            />
            <StatTile
              label="Sales, last 24 hours"
              value={formatCents(
                data.sales_last_24h?.sales_before_refunds_cents ?? 0,
              )}
            />
            <StatTile
              label="Orders, last 7 days"
              value={String(data.sales_last_7d?.orders_count ?? 0)}
            />
            <StatTile
              label="Sales, last 7 days"
              value={formatCents(
                data.sales_last_7d?.sales_before_refunds_cents ?? 0,
              )}
            />
            <StatTile
              label="Refunded, last 7 days"
              value={formatCents(data.refunded_last_7d_cents ?? 0)}
            />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Sales are before refunds.
          </p>
        </section>
      ) : null}

      <section className={`${CARD_CLASS} mt-6`}>
        <h2 className="text-base font-semibold text-stone-900">
          Needs your attention
        </h2>

        {attentionTotal === 0 ? (
          <p className="mt-3 text-sm text-stone-600">
            Nothing needs your attention right now.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {[
              {
                label: "New orders waiting",
                count: data.needs_attention.new_orders_waiting,
              },
              {
                label: "Stock shortage orders",
                count: data.needs_attention.stock_shortage_orders,
              },
              {
                label: "Unscheduled deliveries",
                count: data.needs_attention.deliveries_unscheduled,
              },
            ].map((row) => (
              <li key={row.label}>
                <Link
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-stone-700 hover:text-stone-900"
                  href="/admin/orders"
                >
                  <span>{row.label}</span>
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-800">
                    {row.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
        <StockTable
          title="Low stock"
          group={data.low_stock}
          emptyLabel="No low-stock products right now."
        />
        <StockTable
          title="Out of stock"
          group={data.out_of_stock}
          emptyLabel="No products are out of stock right now."
        />
      </div>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
        <section className={`${CARD_CLASS} min-w-0`}>
          <h2 className="text-base font-semibold text-stone-900">
            Upcoming deliveries
          </h2>
          {data.upcoming_deliveries.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              No deliveries are scheduled in the next 7 days.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100">
              {data.upcoming_deliveries.map((delivery) => (
                <UpcomingDeliveryRow
                  key={`${delivery.order_number}-${delivery.scheduled_date}`}
                  delivery={delivery}
                />
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD_CLASS} min-w-0`}>
          <h2 className="text-base font-semibold text-stone-900">
            Recent orders
          </h2>
          {data.recent_orders.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              No paid orders yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100">
              {data.recent_orders.map((order) => (
                <RecentOrderRow
                  key={order.order_number}
                  order={order}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
