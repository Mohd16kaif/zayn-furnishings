import { describe, expect, it } from "vitest";
import {
  applyRefundState,
  refundEventRawEventId,
  refundRawEventId,
  summarizeRefunds,
  validateRefundRequest,
} from "../src/lib/refundLedger";
import {
  createFakeRefundDb,
  createFakeRefundState,
  type FakeRefundState,
} from "./helpers/fakeRefundDb";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "ZF-100001",
    status: "paid",
    totalCents: 10000,
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function succeededPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    orderId: "order-1",
    provider: "stripe",
    providerPaymentId: "pi_123",
    amountCents: 10000,
    currency: "usd",
    status: "succeeded",
    rawEventId: "pi_succeeded:pi_123",
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    orderId: "order-1",
    status: "pending",
    ...overrides,
  };
}

function baseState(overrides: Partial<FakeRefundState> = {}) {
  const state = createFakeRefundState({
    orders: [orderRow()],
    payments: [succeededPayment()],
    deliveries: [deliveryRow()],
    ...overrides,
  });

  return { state, db: createFakeRefundDb(state) };
}

type Executor = Parameters<typeof applyRefundState>[0];

function executor(db: ReturnType<typeof createFakeRefundDb>): Executor {
  return db as unknown as Executor;
}

describe("summarizeRefunds", () => {
  it("uses succeeded payments and sums only refund rows", () => {
    expect(
      summarizeRefunds(
        [
          { status: "succeeded", amountCents: 10000 },
          { status: "failed", amountCents: 8000 },
          { status: "refunded", amountCents: 2500 },
          { status: "refunded", amountCents: 1500 },
        ],
        10000,
      ),
    ).toEqual({
      paidAmountCents: 10000,
      totalRefundedCents: 4000,
      refundableRemainingCents: 6000,
    });
  });
});

describe("applyRefundState", () => {
  it("does nothing when the same refund is replayed", async () => {
    const { state, db } = baseState();
    const refund = {
      id: "re_1",
      amountCents: 2500,
      createdAt: new Date("2026-11-13T11:00:00.000Z"),
    };

    const first = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [refund],
    });

    expect(first.orderStatus).toBe("partially_refunded");
    expect(first.totalRefundedCents).toBe(2500);
    expect(first.insertedRawEventIds).toEqual([
      refundRawEventId("re_1"),
    ]);
    expect(state.payments).toHaveLength(2);

    const second = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [refund],
    });

    expect(second.orderStatus).toBe("partially_refunded");
    expect(second.totalRefundedCents).toBe(2500);
    expect(second.insertedRawEventIds).toEqual([]);
    expect(second.deliveryCancelled).toBe(false);
    expect(state.payments).toHaveLength(2);
    expect(state.orders[0].status).toBe("partially_refunded");
  });

  it("goes from partial to fully refunded from ledger totals", async () => {
    const { state, db } = baseState();

    const partial = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [{ id: "re_1", amountCents: 4000 }],
    });

    expect(partial.orderStatus).toBe("partially_refunded");
    expect(partial.refundableRemainingCents).toBe(6000);

    const full = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [{ id: "re_2", amountCents: 6000 }],
    });

    expect(full.orderStatus).toBe("refunded");
    expect(full.fullyRefunded).toBe(true);
    expect(full.totalRefundedCents).toBe(10000);
    expect(full.refundableRemainingCents).toBe(0);
    expect(state.orders[0].status).toBe("refunded");
    expect(state.deliveries[0].status).toBe("cancelled");
  });

  it("records a dashboard-only refund difference under the event key", async () => {
    const { state, db } = baseState();

    const first = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [],
      stripeAmountRefundedCents: 5000,
      fallbackRawEventId: "evt_dashboard_1",
      fallbackCreatedAt: new Date("2026-11-13T12:00:00.000Z"),
    });

    expect(first.orderStatus).toBe("partially_refunded");
    expect(first.totalRefundedCents).toBe(5000);
    expect(first.insertedRawEventIds).toEqual([
      refundEventRawEventId("evt_dashboard_1"),
    ]);
    expect(state.payments).toHaveLength(2);
    expect(state.payments[1]).toMatchObject({
      amountCents: 5000,
      status: "refunded",
      rawEventId: refundEventRawEventId("evt_dashboard_1"),
    });

    const replay = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [],
      stripeAmountRefundedCents: 5000,
      fallbackRawEventId: "evt_dashboard_1",
    });

    expect(replay.insertedRawEventIds).toEqual([]);
    expect(state.payments).toHaveLength(2);
    expect(replay.totalRefundedCents).toBe(5000);
  });

  it("leaves an out-for-delivery delivery untouched on a full refund", async () => {
    const { state, db } = baseState({
      deliveries: [deliveryRow({ status: "out_for_delivery" })],
    });

    const result = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [{ id: "re_full", amountCents: 10000 }],
    });

    expect(result.orderStatus).toBe("refunded");
    expect(result.deliveryCancelled).toBe(false);
    expect(state.deliveries[0].status).toBe("out_for_delivery");
  });

  it("does not cancel a delivery that was already delivered", async () => {
    const { state, db } = baseState({
      deliveries: [deliveryRow({ status: "delivered" })],
    });

    const result = await applyRefundState(executor(db), {
      orderId: "order-1",
      refunds: [{ id: "re_full", amountCents: 10000 }],
    });

    expect(result.orderStatus).toBe("refunded");
    expect(result.deliveryCancelled).toBe(false);
    expect(state.deliveries[0].status).toBe("delivered");
  });
});

describe("validateRefundRequest", () => {
  const base = {
    orderStatus: "paid" as const,
    hasSucceededStripePayment: true,
    paidAmountCents: 10000,
    totalRefundedCents: 0,
    restock: false,
  };

  it("defaults to the full remaining amount", () => {
    expect(validateRefundRequest(base)).toEqual({
      ok: true,
      amountCents: 10000,
    });
  });

  it("rejects amounts below one cent and above the remaining balance", () => {
    expect(
      validateRefundRequest({ ...base, amountCents: 0 }),
    ).toMatchObject({ ok: false, status: 400 });

    expect(
      validateRefundRequest({ ...base, amountCents: 10001 }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects restock on a partial refund", () => {
    expect(
      validateRefundRequest({
        ...base,
        amountCents: 5000,
        restock: true,
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("allows restock when the refund is the full remaining amount", () => {
    expect(
      validateRefundRequest({
        ...base,
        totalRefundedCents: 2500,
        restock: true,
      }),
    ).toEqual({ ok: true, amountCents: 7500 });
  });

  it("rejects orders outside the refundable statuses", () => {
    expect(
      validateRefundRequest({ ...base, orderStatus: "cancelled" }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      validateRefundRequest({ ...base, orderStatus: "refunded" }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects orders with no captured Stripe payment", () => {
    expect(
      validateRefundRequest({
        ...base,
        hasSucceededStripePayment: false,
      }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects an already fully refunded order", () => {
    expect(
      validateRefundRequest({
        ...base,
        totalRefundedCents: 10000,
      }),
    ).toMatchObject({ ok: false, status: 409 });
  });
});
