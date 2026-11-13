"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  adminFetch,
  AdminApiError,
  type AdminOrderListItem,
  type AdminOrderListResponse,
  type AdminOrderStatus,
} from "@/lib/adminApi";
import {
  deliveryStatusLabel,
  formatAdminDate,
  orderStatusBadgeClass,
  orderStatusLabel,
} from "@/lib/adminOrderLabels";
import { subscribeToOrdersChanged } from "@/lib/adminOrderEvents";
import { formatCents } from "@/lib/money";

const PAGE_SIZE = 25;

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10";

type OrderTab = {
  id: string;
  label: string;
  statuses: AdminOrderStatus[] | null;
};

const ORDER_TABS: OrderTab[] = [
  { id: "all", label: "All", statuses: null },
  { id: "paid", label: "New", statuses: ["paid"] },
  { id: "processing", label: "Preparing", statuses: ["processing"] },
  {
    id: "out_for_delivery",
    label: "Out for delivery",
    statuses: ["out_for_delivery"],
  },
  { id: "delivered", label: "Delivered", statuses: ["delivered"] },
  { id: "pending", label: "Awaiting payment", statuses: ["pending"] },
  {
    id: "closed",
    label: "Cancelled and refunded",
    statuses: ["cancelled", "refunded", "partially_refunded"],
  },
];

function tabCount(
  tab: OrderTab,
  counts: Record<AdminOrderStatus, number> | null,
): number | null {
  if (!counts) {
    return null;
  }

  if (!tab.statuses) {
    const total = Object.values(counts).reduce(
      (sum, value) => sum + value,
      0,
    );
    return Math.max(0, total - counts.pending);
  }

  return tab.statuses.reduce(
    (sum, status) => sum + (counts[status] ?? 0),
    0,
  );
}

export function OrdersClient() {
  const router = useRouter();
  const [activeTabId, setActiveTabId] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminOrderListItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: PAGE_SIZE,
    total: 0,
    total_pages: 0,
    has_more: false,
  });
  const [counts, setCounts] = useState<Record<
    AdminOrderStatus,
    number
  > | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadOrders = useCallback(async () => {
    setLoadStatus("loading");
    setError("");

    const activeTab =
      ORDER_TABS.find((tab) => tab.id === activeTabId) ?? ORDER_TABS[0];
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });

    if (activeTab.statuses) {
      params.set("status", activeTab.statuses.join(","));
    }

    if (search) {
      params.set("q", search);
    }

    if (dateFrom) {
      params.set("date_from", dateFrom);
    }

    if (dateTo) {
      params.set("date_to", dateTo);
    }

    try {
      const data = await adminFetch<AdminOrderListResponse>(
        `/admin/orders?${params.toString()}`,
      );

      setItems(data.items);
      setPagination(data.pagination);
      setCounts(data.counts_by_status);
      setLoadStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof AdminApiError &&
          loadError.status === 403
          ? "You do not have permission to view orders."
          : loadError instanceof Error
            ? loadError.message
            : "Unable to load orders.",
      );
      setLoadStatus("error");
    }
  }, [activeTabId, search, dateFrom, dateTo, page]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();

      if (!cancelled) {
        await loadOrders();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [loadOrders]);

  useEffect(
    () =>
      subscribeToOrdersChanged(() => {
        void loadOrders();
      }),
    [loadOrders],
  );

  function selectTab(tabId: string) {
    setActiveTabId(tabId);
    setPage(1);
  }

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const totalPages = Math.max(1, pagination.total_pages);
  const start =
    pagination.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, pagination.total);
  const hasFilters = Boolean(search || dateFrom || dateTo);

  return (
    <div>
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
          Orders
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Customer orders
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Find orders, check what needs to be prepared, and keep customers
          updated. Awaiting-payment orders are hidden from All until you open
          that tab.
        </p>
      </div>

      <div className="mt-6 border-b border-stone-200">
        <div
          className="flex gap-2 overflow-x-auto"
          role="tablist"
          aria-label="Order status"
        >
          {ORDER_TABS.map((tab) => {
            const isActive = tab.id === activeTabId;
            const count = tabCount(tab, counts);

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`orders-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls="orders-panel"
                onClick={() => selectTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium ${
                  isActive
                    ? "border-b-2 border-stone-900 text-stone-900"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                {tab.label}
                {count !== null ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      isActive
                        ? "bg-stone-900 text-white"
                        : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id="orders-panel"
        aria-labelledby={`orders-tab-${activeTabId}`}
        className="mt-4"
      >
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label
                htmlFor="order-search"
                className="block text-xs font-medium uppercase tracking-wide text-stone-500"
              >
                Search
              </label>
              <input
                id="order-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order number, name, phone, or email"
                className={`${inputClass} mt-1`}
              />
            </div>

            <div>
              <label
                htmlFor="order-date-from"
                className="block text-xs font-medium uppercase tracking-wide text-stone-500"
              >
                From
              </label>
              <input
                id="order-date-from"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className={`${inputClass} mt-1`}
              />
            </div>

            <div>
              <label
                htmlFor="order-date-to"
                className="block text-xs font-medium uppercase tracking-wide text-stone-500"
              >
                To
              </label>
              <input
                id="order-date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                className={`${inputClass} mt-1`}
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                disabled={!hasFilters}
                className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {loadStatus === "loading" ? (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              Loading orders...
            </p>
          ) : null}

          {loadStatus === "error" ? (
            <div className="px-4 py-10 text-center">
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void loadOrders()}
                className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Try again
              </button>
            </div>
          ) : null}

          {loadStatus === "ready" && items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              {hasFilters
                ? "No orders match these filters."
                : "No orders in this tab yet."}
            </p>
          ) : null}

          {loadStatus === "ready" && items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((order) => {
                    const href = `/admin/orders/${order.order_number}`;

                    return (
                      <tr
                        key={order.order_number}
                        onClick={() => router.push(href)}
                        className="cursor-pointer border-t border-stone-100 align-top hover:bg-stone-50"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={href}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900"
                          >
                            {order.order_number}
                          </Link>
                          {order.has_stock_shortage ? (
                            <span className="mt-1 block text-xs font-medium text-red-700">
                              Stock issue
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {formatAdminDate(order.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-stone-900">
                            {order.customer_name ?? "Guest"}
                          </p>
                          <p className="mt-0.5 text-xs text-stone-500">
                            {order.customer_phone ?? "No phone"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {order.item_count} item
                          {order.item_count === 1 ? "" : "s"}
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-900">
                          {formatCents(order.total_cents)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${orderStatusBadgeClass(
                              order.status,
                            )}`}
                          >
                            {orderStatusLabel(order.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {deliveryStatusLabel(order.delivery_status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {loadStatus === "ready" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-sm text-stone-600">
              <p>
                Showing {start}–{end} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPage((value) => Math.max(1, value - 1))
                  }
                  disabled={page <= 1}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-stone-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((value) => value + 1)}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
