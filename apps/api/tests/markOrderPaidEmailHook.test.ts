import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  order: null as Row | null,
  scheduleCalls: [] as string[],
  updateCalls: [] as Array<{ table: unknown; values: Row }>,
}));

vi.mock("../src/emails/orderNotifications", () => ({
  scheduleOrderPaidEmails: (orderId: string) => {
    state.scheduleCalls.push(orderId);
    throw new Error("Mail sender unavailable");
  },
}));

vi.mock("../src/db/client", async () => {
  const { orderItems, orders, payments, products, stockMovements } =
    await import("../src/db/schema");

  function rowsFor(table: unknown): Row[] {
    if (table === orders) {
      return state.order ? [state.order] : [];
    }

    if (table === orderItems || table === products) {
      return [];
    }

    return [];
  }

  const tx = {
    select() {
      let table: unknown = null;
      const chain = {
        from(nextTable: unknown) {
          table = nextTable;
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return chain;
        },
        for() {
          return Promise.resolve(rowsFor(table));
        },
        then(
          resolve: (value: Row[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(rowsFor(table)).then(resolve, reject);
        },
      };

      return chain;
    },
    insert(table: unknown) {
      return {
        values() {
          if (table === payments) {
            return {
              onConflictDoNothing() {
                return {
                  returning: async () => [{ id: "payment-1" }],
                };
              },
            };
          }

          if (table === stockMovements) {
            return Promise.resolve(undefined);
          }

          return {
            returning: async () => [],
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
  };

  return {
    db: {
      transaction: async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx),
    },
    connection: null,
  };
});

import { markOrderPaid } from "../src/lib/markOrderPaid";

beforeEach(() => {
  state.order = {
    id: "o1",
    orderNumber: "ZF-100030",
    status: "pending",
    totalCents: 124800,
    stripePaymentIntentId: "pi_1",
    internalNotes: null,
    discountCode: null,
  };
  state.scheduleCalls.length = 0;
  state.updateCalls.length = 0;
});

describe("markOrderPaid email hook", () => {
  it("keeps the paid result when the email sender fails", async () => {
    const result = await markOrderPaid({
      paymentIntentId: "pi_1",
      amountReceivedCents: 124800,
      currency: "usd",
    });

    expect(result.status).toBe("paid");
    expect(result.orderId).toBe("o1");
    expect(result.orderNumber).toBe("ZF-100030");
    expect(state.scheduleCalls).toEqual(["o1"]);
    expect(
      state.updateCalls.some(
        (call) => call.values.status === "paid",
      ),
    ).toBe(true);
  });
});
