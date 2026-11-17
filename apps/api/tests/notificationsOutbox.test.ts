import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  notificationRow: null as Row | null,
  orderRow: null as Row | null,
  itemRows: [] as Row[],
  insertResults: [] as Row[][],
  insertCalls: [] as Array<{ table: unknown; values: Row }>,
  updateCalls: [] as Array<{ table: unknown; values: Row }>,
  settings: {
    store_name: "Zayn Furnishings",
    phone: "",
    email: "owner@example.com",
    free_delivery_threshold_cents: null,
    show_financing: false,
  },
  sendMessages: [] as Row[],
  sender: {
    name: "resend",
    send: async (_message: Row) => ({ providerMessageId: "pm_default" }),
  } as {
    name: string;
    send: (message: Row) => Promise<{ providerMessageId: string }>;
  },
}));

vi.mock("../src/emails/sender", () => ({
  getEmailSender: () => state.sender,
}));

vi.mock("../src/lib/storeSettings", () => ({
  readStoreSettings: async () => state.settings,
}));

vi.mock("../src/db/client", async () => {
  const { notificationsLog, orderItems, orders } = await import(
    "../src/db/schema"
  );

  function rowsFor(table: unknown): Row[] {
    if (table === notificationsLog) {
      return state.notificationRow ? [state.notificationRow] : [];
    }

    if (table === orders) {
      return state.orderRow ? [state.orderRow] : [];
    }

    if (table === orderItems) {
      return state.itemRows;
    }

    return [];
  }

  function selectBuilder() {
    let table: unknown = null;
    const chain = {
      from(nextTable: unknown) {
        table = nextTable;
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      then(
        resolve: (value: Row[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(rowsFor(table)).then(resolve, reject);
      },
    };

    return chain;
  }

  return {
    db: {
      select: () => selectBuilder(),
      insert(table: unknown) {
        return {
          values(values: Row) {
            state.insertCalls.push({ table, values });
            const rows = state.insertResults.shift() ?? [];

            return {
              onConflictDoNothing() {
                return {
                  returning: async () => rows,
                };
              },
              returning: async () => rows,
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Row) {
            state.updateCalls.push({ table, values });

            return {
              where: async () => undefined,
            };
          },
        };
      },
    },
    connection: null,
  };
});

import {
  dispatchNotification,
  enqueueNotification,
} from "../src/emails/outbox";
import {
  ORDER_CONFIRMATION_TEMPLATE,
  OWNER_NEW_ORDER_TEMPLATE,
} from "../src/emails/outbox";
import { queueAndDispatchOrderPaidEmails } from "../src/emails/orderNotifications";

function notificationRow(overrides: Row = {}): Row {
  return {
    id: "n1",
    orderId: "o1",
    template: ORDER_CONFIRMATION_TEMPLATE,
    toAddress: "buyer@example.com",
    status: "queued",
    attempts: 0,
    ...overrides,
  };
}

function orderRow(overrides: Row = {}): Row {
  return {
    id: "o1",
    email: "buyer@example.com",
    orderNumber: "ZF-100030",
    subtotalCents: 124800,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    totalCents: 124800,
    shippingName: "Jordan Lee",
    shippingLine1: "123 Example Street",
    shippingLine2: null,
    shippingCity: "Brooklyn",
    shippingState: "NY",
    shippingZip: "11201",
    ...overrides,
  };
}

function itemRow(): Row {
  return {
    nameSnapshot: "Oak Dining Chair",
    quantity: 1,
    lineTotalCents: 124800,
  };
}

beforeEach(() => {
  state.notificationRow = null;
  state.orderRow = null;
  state.itemRows = [];
  state.insertResults.length = 0;
  state.insertCalls.length = 0;
  state.updateCalls.length = 0;
  state.sendMessages.length = 0;
  state.settings = {
    store_name: "Zayn Furnishings",
    phone: "",
    email: "owner@example.com",
    free_delivery_threshold_cents: null,
    show_financing: false,
  };
  state.sender = {
    name: "resend",
    send: async (message: Row) => {
      state.sendMessages.push(message);
      return { providerMessageId: "pm_1" };
    },
  };
});

describe("notification outbox", () => {
  it("deduplicates by dedupe key", async () => {
    state.insertResults.push([{ id: "n1" }], []);

    const first = await enqueueNotification({
      template: ORDER_CONFIRMATION_TEMPLATE,
      orderId: "o1",
      toAddress: "buyer@example.com",
      dedupeKey: "order_confirmation:o1",
    });
    const second = await enqueueNotification({
      template: ORDER_CONFIRMATION_TEMPLATE,
      orderId: "o1",
      toAddress: "buyer@example.com",
      dedupeKey: "order_confirmation:o1",
    });

    expect(first).toEqual({ inserted: true, id: "n1" });
    expect(second).toEqual({ inserted: false, id: null });
    expect(state.insertCalls[0].values).toMatchObject({
      channel: "email",
      status: "queued",
      attempts: 0,
      dedupeKey: "order_confirmation:o1",
    });
  });

  it("marks a failed send and never throws", async () => {
    state.notificationRow = notificationRow();
    state.orderRow = orderRow();
    state.itemRows = [itemRow()];
    state.sender = {
      name: "resend",
      send: async () => {
        throw new Error("Provider rejected buyer@example.com");
      },
    };

    const result = await dispatchNotification("n1");
    const update = state.updateCalls.at(-1);

    expect(result.status).toBe("failed");
    expect(update?.values.status).toBe("failed");
    expect(String(update?.values.error)).toContain("bu***@example.com");
    expect(String(update?.values.error)).not.toContain(
      "buyer@example.com",
    );
  });

  it("stores logged when the log sender handles the message", async () => {
    state.notificationRow = notificationRow();
    state.orderRow = orderRow();
    state.itemRows = [itemRow()];
    state.sender = {
      name: "log",
      send: async () => ({ providerMessageId: "log_1" }),
    };

    const result = await dispatchNotification("n1");
    const update = state.updateCalls.at(-1);

    expect(result.status).toBe("logged");
    expect(update?.values.status).toBe("logged");
    expect(update?.values.providerMessageId).toBe("log_1");
    expect(update?.values.sentAt).toBeInstanceOf(Date);
  });

  it("skips owner mail when no store email is configured", async () => {
    state.settings = { ...state.settings, email: "" };
    state.orderRow = orderRow();
    state.itemRows = [itemRow()];
    state.notificationRow = notificationRow();
    state.insertResults.push([{ id: "n1" }]);

    const result = await queueAndDispatchOrderPaidEmails("o1");

    expect(result.customerEnqueued).toBe(true);
    expect(result.ownerEnqueued).toBe(false);
    expect(state.insertCalls).toHaveLength(1);
    expect(
      state.insertCalls.some(
        (call) => call.values.template === OWNER_NEW_ORDER_TEMPLATE,
      ),
    ).toBe(false);
    expect(state.sendMessages).toHaveLength(1);
    expect(state.sendMessages[0].to).toBe("buyer@example.com");
  });
});
