import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeRefundDb,
  createFakeRefundState,
  type FakeRefundState,
} from "./helpers/fakeRefundDb";

const mock = vi.hoisted(() => ({
  db: null as unknown,
  send: vi.fn(async () => ({ providerMessageId: "pm_test" })),
}));

vi.mock("../src/db/client", () => ({
  get db() {
    return mock.db;
  },
  connection: null,
}));

vi.mock("../src/emails/sender", () => ({
  getEmailSender: () => ({
    name: "resend",
    send: mock.send,
  }),
}));

import {
  queueDeliveryEmails,
} from "../src/emails/deliveryNotifications";
import { queueRefundIssuedEmails } from "../src/emails/refundNotifications";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "ZF-100001",
    status: "paid",
    email: "buyer@example.com",
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
    status: "scheduled",
    partnerName: "Zayn Delivery Co.",
    trackingNumber: null,
    scheduledDate: "2026-11-14",
    timeWindow: "Morning",
    driverNotes: null,
    ...overrides,
  };
}

function setup(orderOverrides: Record<string, unknown> = {}) {
  const state: FakeRefundState = createFakeRefundState({
    orders: [orderRow(orderOverrides)],
    payments: [succeededPayment()],
    deliveries: [deliveryRow()],
  });

  const db = createFakeRefundDb(state);
  mock.db = db;

  return { state, db };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mock.send.mockReset();
  mock.send.mockResolvedValue({ providerMessageId: "pm_test" });
});

describe("refund issued emails", () => {
  it("enqueues once per refund row and never emails a replay twice", async () => {
    const { state, db } = setup();
    const keys = ["refund:re_1"];

    const first = await queueRefundIssuedEmails("order-1", keys);
    const replay = await queueRefundIssuedEmails("order-1", keys);

    expect(first).toBe(1);
    expect(replay).toBe(0);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      template: "refund_issued",
      dedupeKey: "refund_issued:refund:re_1",
      orderId: "order-1",
    });
    expect(state.notifications[0].toAddress).toBe("buyer@example.com");
  });

  it("skips and logs a masked message when the order has no email", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { state } = setup({ email: "   " });

    const dispatched = await queueRefundIssuedEmails("order-1", [
      "refund:re_1",
    ]);

    expect(dispatched).toBe(0);
    expect(state.notifications).toHaveLength(0);
    expect(info).toHaveBeenCalledWith(
      "Email skipped, no email address (order ZF-100001).",
    );
  });
});

describe("delivery emails", () => {
  it("uses a stable dedupe key and sends each event only once", async () => {
    const { state } = setup();

    const first = await queueDeliveryEmails({
      orderId: "order-1",
      orderNumber: "ZF-100001",
      events: ["out_for_delivery"],
      scheduledDate: "2026-11-14",
      timeWindow: "Morning",
    });
    const replay = await queueDeliveryEmails({
      orderId: "order-1",
      orderNumber: "ZF-100001",
      events: ["out_for_delivery"],
      scheduledDate: "2026-11-14",
      timeWindow: "Morning",
    });

    expect(first).toBe(1);
    expect(replay).toBe(0);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      template: "out_for_delivery",
      dedupeKey: "out_for_delivery:order-1",
      status: "sent",
    });
  });

  it("keeps the queue result when the sender fails", async () => {
    const { state } = setup();
    mock.send.mockRejectedValue(
      new Error("Provider rejected buyer@example.com"),
    );

    const dispatched = await queueDeliveryEmails({
      orderId: "order-1",
      orderNumber: "ZF-100001",
      events: ["out_for_delivery"],
      scheduledDate: "2026-11-14",
      timeWindow: "Morning",
    });

    expect(dispatched).toBe(1);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].status).toBe("failed");
    expect(String(state.notifications[0].error)).toContain(
      "bu***@example.com",
    );
  });

  it("includes the delivery date and window in the scheduled dedupe key", async () => {
    const { state } = setup();

    await queueDeliveryEmails({
      orderId: "order-1",
      orderNumber: "ZF-100001",
      events: ["delivery_scheduled"],
      scheduledDate: "2026-11-14",
      timeWindow: "Morning",
    });

    expect(state.notifications[0].dedupeKey).toBe(
      "delivery_scheduled:order-1:2026-11-14:Morning",
    );
    expect(state.notifications[0].template).toBe(
      "delivery_scheduled",
    );
  });
});
