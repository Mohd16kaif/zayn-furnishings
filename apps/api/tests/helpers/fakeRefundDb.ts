import {
  auditLog,
  customers,
  deliveries,
  orderItems,
  orders,
  payments,
  products,
  stockMovements,
} from "../../src/db/schema";

export type FakeRow = Record<string, unknown>;

export type FakeRefundState = {
  orders: FakeRow[];
  customers: FakeRow[];
  payments: FakeRow[];
  deliveries: FakeRow[];
  orderItems: FakeRow[];
  products: FakeRow[];
  stockMovements: FakeRow[];
  audits: FakeRow[];
  sequence: number;
};

export function createFakeRefundState(
  overrides: Partial<FakeRefundState> = {},
): FakeRefundState {
  return {
    orders: [],
    customers: [],
    payments: [],
    deliveries: [],
    orderItems: [],
    products: [],
    stockMovements: [],
    audits: [],
    sequence: 0,
    ...overrides,
  };
}

function nextId(state: FakeRefundState, prefix: string): string {
  state.sequence += 1;

  return `${prefix}-${state.sequence}`;
}

function rowsForTable(
  state: FakeRefundState,
  table: unknown,
): FakeRow[] | null {
  if (table === orders) {
    return state.orders;
  }

  if (table === payments) {
    return state.payments;
  }

  if (table === deliveries) {
    return state.deliveries;
  }

  if (table === orderItems) {
    return state.orderItems;
  }

  if (table === products) {
    return state.products;
  }

  if (table === stockMovements) {
    return state.stockMovements;
  }

  if (table === auditLog) {
    return state.audits;
  }

  return null;
}

export function createFakeRefundDb(state: FakeRefundState) {
  const db = {
    select(selection?: Record<string, unknown>) {
      let table: unknown = null;
      let selectedRows: FakeRow[] = [];

      const resolveRows = (): FakeRow[] => {
        const rows = rowsForTable(state, table);

        if (rows) {
          selectedRows = rows;
        }

        if (!selection) {
          return selectedRows;
        }

        return selectedRows.map((row) => {
          const mapped: FakeRow = {};

          for (const key of Object.keys(selection)) {
            if (selection[key] === orders) {
              mapped[key] = row;
            } else if (selection[key] === customers) {
              mapped[key] = state.customers[0] ?? null;
            } else if (key === "customer") {
              mapped[key] = state.customers[0] ?? null;
            } else if (key === "order") {
              mapped[key] = row;
            } else if (key in row) {
              mapped[key] = row[key];
            } else {
              mapped[key] = null;
            }
          }

          return mapped;
        });
      };

      const builder = {
        from(nextTable: unknown) {
          table = nextTable;
          return builder;
        },
        where() {
          return builder;
        },
        leftJoin() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        for() {
          return Promise.resolve(resolveRows());
        },
        then(
          onFulfilled?: (value: FakeRow[]) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(resolveRows()).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return builder;
    },
    insert(table: unknown) {
      let pending: FakeRow | FakeRow[] | null = null;
      let applied = false;
      let inserted: FakeRow[] = [];

      const apply = () => {
        if (applied || pending === null) {
          return;
        }

        applied = true;
        const values = Array.isArray(pending) ? pending : [pending];
        const rows = rowsForTable(state, table);

        if (!rows) {
          return;
        }

        for (const value of values) {
          if (
            table === payments &&
            typeof value.rawEventId === "string" &&
            rows.some((row) => row.rawEventId === value.rawEventId)
          ) {
            continue;
          }

          const row: FakeRow = {
            id: nextId(state, "row"),
            createdAt: value.createdAt ?? new Date(),
            updatedAt: new Date(),
            ...value,
          };

          rows.push(row);
          inserted.push(row);
        }
      };

      const builder = {
        values(values: FakeRow | FakeRow[]) {
          pending = values;
          return builder;
        },
        onConflictDoNothing() {
          return builder;
        },
        returning() {
          apply();
          return Promise.resolve(inserted);
        },
        then(
          onFulfilled?: (value: undefined) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          apply();
          return Promise.resolve(undefined).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
    update(table: unknown) {
      let values: FakeRow = {};

      const builder = {
        set(nextValues: FakeRow) {
          values = nextValues;
          return builder;
        },
        where() {
          const rows = rowsForTable(state, table) ?? [];

          for (const row of rows) {
            Object.assign(row, values);
          }

          return Promise.resolve(undefined);
        },
      };

      return builder;
    },
    async transaction<T>(
      callback: (tx: typeof db) => Promise<T>,
    ): Promise<T> {
      return callback(db);
    },
  };

  return db;
}
