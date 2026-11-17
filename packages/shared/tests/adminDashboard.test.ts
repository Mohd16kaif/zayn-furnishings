import { describe, expect, it } from "vitest";
import {
  dashboardResponseForRole,
  dashboardWindows,
  isInDashboardWindow,
  rollingDashboardWindow,
  summarizeDashboardRefundedCents,
  summarizeDashboardSales,
  type AdminDashboardBase,
  type AdminDashboardOwnerMetrics,
} from "../src/adminDashboard";

const NOW = new Date("2026-11-17T12:00:00.000Z");

function baseDashboard(): AdminDashboardBase {
  return {
    needs_attention: {
      new_orders_waiting: 2,
      stock_shortage_orders: 1,
      deliveries_unscheduled: 3,
    },
    low_stock: { items: [], total: 0 },
    out_of_stock: { items: [], total: 0 },
    upcoming_deliveries: [],
    recent_orders: [],
  };
}

function ownerMetrics(): AdminDashboardOwnerMetrics {
  return {
    sales_last_24h: {
      orders_count: 2,
      sales_before_refunds_cents: 25000,
    },
    sales_last_7d: {
      orders_count: 5,
      sales_before_refunds_cents: 80000,
    },
    refunded_last_24h_cents: 1000,
    refunded_last_7d_cents: 3000,
  };
}

describe("dashboard rolling windows", () => {
  it("uses UTC timestamps and includes both boundaries", () => {
    const window = rollingDashboardWindow(NOW, 24);

    expect(window.start.toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-17T12:00:00.000Z");
    expect(isInDashboardWindow(window.start, window)).toBe(true);
    expect(isInDashboardWindow(window.end, window)).toBe(true);
    expect(
      isInDashboardWindow(
        new Date(window.start.getTime() - 1),
        window,
      ),
    ).toBe(false);
    expect(
      isInDashboardWindow(new Date(window.end.getTime() + 1), window),
    ).toBe(false);
  });

  it("creates 24 hour and 7 day windows from the same end time", () => {
    const windows = dashboardWindows(NOW);

    expect(windows.last_24h.start.toISOString()).toBe(
      "2026-11-16T12:00:00.000Z",
    );
    expect(windows.last_7d.start.toISOString()).toBe(
      "2026-11-10T12:00:00.000Z",
    );
    expect(windows.last_7d.end.getTime()).toBe(NOW.getTime());
  });

  it("treats missing timestamps as outside the window", () => {
    expect(isInDashboardWindow(null, dashboardWindows(NOW).last_24h)).toBe(
      false,
    );
  });
});

describe("dashboard sales and refunds", () => {
  it("counts paid orders by paid time and keeps cents whole", () => {
    const window = dashboardWindows(NOW).last_24h;

    const result = summarizeDashboardSales(
      [
        {
          status: "paid",
          paidAt: "2026-11-17T10:00:00.000Z",
          totalCents: 12500,
        },
        {
          status: "delivered",
          paidAt: new Date("2026-11-16T12:00:00.000Z"),
          totalCents: 5000,
        },
        {
          status: "pending",
          paidAt: "2026-11-17T11:00:00.000Z",
          totalCents: 9900,
        },
        {
          status: "cancelled",
          paidAt: "2026-11-17T11:00:00.000Z",
          totalCents: 7700,
        },
        {
          status: "processing",
          paidAt: "2026-11-15T11:00:00.000Z",
          totalCents: 4000,
        },
        {
          status: "paid",
          paidAt: null,
          totalCents: 3000,
        },
      ],
      window,
    );

    expect(result).toEqual({
      orders_count: 2,
      sales_before_refunds_cents: 17500,
    });
  });

  it("sums refund ledger rows by their created time", () => {
    const windows = dashboardWindows(NOW);

    const payments = [
      {
        status: "refunded",
        createdAt: "2026-11-17T09:00:00.000Z",
        amountCents: 1000,
      },
      {
        status: "refunded",
        createdAt: "2026-11-13T09:00:00.000Z",
        amountCents: 2000,
      },
      {
        status: "refunded",
        createdAt: "2026-11-01T09:00:00.000Z",
        amountCents: 8000,
      },
      {
        status: "succeeded",
        createdAt: "2026-11-17T09:00:00.000Z",
        amountCents: 5000,
      },
    ];

    expect(summarizeDashboardRefundedCents(payments, windows.last_24h)).toBe(
      1000,
    );
    expect(summarizeDashboardRefundedCents(payments, windows.last_7d)).toBe(
      3000,
    );
  });
});

describe("dashboard response shape by role", () => {
  it("includes owner-only metrics for an owner", () => {
    const response = dashboardResponseForRole(
      "owner",
      baseDashboard(),
      ownerMetrics(),
    );

    expect(response).toMatchObject(ownerMetrics());
    expect(response.needs_attention.new_orders_waiting).toBe(2);
  });

  it("omits owner-only keys entirely for staff", () => {
    const response = dashboardResponseForRole(
      "staff",
      baseDashboard(),
      ownerMetrics(),
    );

    expect(response).not.toHaveProperty("sales_last_24h");
    expect(response).not.toHaveProperty("sales_last_7d");
    expect(response).not.toHaveProperty("refunded_last_24h_cents");
    expect(response).not.toHaveProperty("refunded_last_7d_cents");
    expect(Object.values(response)).not.toContain(null);
    expect(response).toEqual(baseDashboard());
  });
});
