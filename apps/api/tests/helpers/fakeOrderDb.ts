import {
  customers,
  deliveries,
  discountCodes,
  orderItems,
  orders,
  products,
} from "../../src/db/schema";

export type FakeOrderRow = Record<string, unknown>;

export type FakeOrderState = {
  customerId: string;
  customers: FakeOrderRow[];
  products: FakeOrderRow[];
  orders: FakeOrderRow[];
  orderItems: FakeOrderRow[];
  deliveries: FakeOrderRow[];
  sequence: number;
  orderSequence: number;
  lastInsertedOrderId: string | null;
};

export function createFakeOrderState(
  overrides: Partial<FakeOrderState> = {},
): FakeOrderState {
  return {
    customerId: "11111111-1111-4111-8111-111111111112",
    customers: [],
    products: [],
    orders: [],
    orderItems: [],
    deliveries: [],
    sequence: 0,
    orderSequence: 0,
    lastInsertedOrderId: null,
    ...overrides,
  };
}

export function createFakeOrderDb(state: FakeOrderState) {
  function rowsForTable(table: unknown): FakeOrderRow[] | null {
    if (table === orders) {
      return state.orders;
    }
    if (table === products) {
      return state.products;
    }
    if (table === customers) {
      return state.customers;
    }
    if (table === orderItems) {
      return state.orderItems;
    }
    if (table === deliveries) {
      return state.deliveries;
    }
    if (table === discountCodes) {
      return [];
    }
    return null;
  }

  const database = {
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
        leftJoin() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit() {
          return chain;
        },
        for() {
          return Promise.resolve(resolveRows());
        },
        then(
          resolve?: (value: FakeOrderRow[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(resolveRows()).then(resolve, reject);
        },
      };

      function resolveRows(): FakeOrderRow[] {
        if (table === orders) {
          return state.orders.filter(
            (order) =>
              order.customerId === state.customerId &&
              typeof order.idempotencyKey === "string" &&
              order.idempotencyKey.length > 0,
          );
        }

        if (table === customers) {
          return state.customers.filter(
            (customer) => customer.id === state.customerId,
          );
        }

        return rowsForTable(table) ?? [];
      }

      return chain;
    },

    insert(table: unknown) {
      let pending: FakeOrderRow | FakeOrderRow[] | null = null;
      let applied = false;
      let returned: FakeOrderRow[] = [];

      function apply() {
        if (applied || pending === null) {
          return;
        }

        applied = true;
        const values = Array.isArray(pending) ? pending : [pending];

        if (table === orders) {
          for (const value of values) {
            const customerId = String(value.customerId ?? "");
            const idempotencyKey =
              typeof value.idempotencyKey === "string"
                ? value.idempotencyKey
                : null;

            if (
              idempotencyKey &&
              state.orders.some(
                (order) =>
                  order.customerId === customerId &&
                  order.idempotencyKey === idempotencyKey,
              )
            ) {
              const error = new Error(
                "duplicate key value violates unique constraint",
              ) as Error & { code?: string; constraint_name?: string };
              error.code = "23505";
              error.constraint_name =
                "orders_customer_id_idempotency_key_unique";
              throw error;
            }

            state.orderSequence += 1;
            state.sequence += 1;
            const row = {
              id: `order-${state.orderSequence}`,
              orderNumber: `ZF-TEST-${state.orderSequence}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              cancelledAt: null,
              paidAt: null,
              stripePaymentIntentId: null,
              ...value,
            };
            state.orders.push(row);
            state.lastInsertedOrderId = String(row.id);
            returned.push(row);
          }
          return;
        }

        const rows = rowsForTable(table);

        if (!rows) {
          return;
        }

        for (const value of values) {
          state.sequence += 1;
          const row = {
            id: `row-${state.sequence}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...value,
          };
          rows.push(row);
          returned.push(row);
        }
      }

      const builder = {
        values(values: FakeOrderRow | FakeOrderRow[]) {
          pending = values;
          return builder;
        },
        onConflictDoNothing() {
          return builder;
        },
        returning() {
          apply();
          return Promise.resolve(returned);
        },
        then(
          resolve?: (value: undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          apply();
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };

      return builder;
    },

    update(table: unknown) {
      let values: FakeOrderRow = {};
      let applied = false;
      let updated: FakeOrderRow[] = [];

      function apply() {
        if (applied) {
          return;
        }
        applied = true;

        if (table === orders) {
          const row =
            state.orders.find(
              (order) => order.id === state.lastInsertedOrderId,
            ) ?? state.orders[state.orders.length - 1];

          if (row) {
            Object.assign(row, values);
            updated = [row];
          }
          return;
        }

        if (table === customers) {
          const row = state.customers.find(
            (customer) => customer.id === state.customerId,
          );

          if (row) {
            Object.assign(row, values);
            updated = [row];
          }
        }
      }

      const builder = {
        set(nextValues: FakeOrderRow) {
          values = nextValues;
          return builder;
        },
        where() {
          return builder;
        },
        returning() {
          apply();
          return Promise.resolve(updated);
        },
        then(
          resolve?: (value: undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          apply();
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };

      return builder;
    },

    async transaction<T>(
      callback: (tx: typeof database) => Promise<T>,
    ): Promise<T> {
      return callback(database);
    },
  };

  return database;
}
