"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "zf-cart";
const CHANGE_EVENT = "zf-cart-change";
const MAX_QUANTITY = 10;

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  quantity: number;
};

export type CartContextValue = {
  items: CartItem[];
  count: number;
  add: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  remove: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const EMPTY_CART: CartItem[] = [];

let cachedRaw: string | null | undefined;
let cachedItems: CartItem[] = EMPTY_CART;

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    return 1;
  }

  return Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)));
}

function parseCart(raw: string | null): CartItem[] {
  if (!raw) {
    return EMPTY_CART;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return EMPTY_CART;
    }

    const items: CartItem[] = [];

    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const record = entry as Record<string, unknown>;

      if (
        typeof record.productId !== "string" ||
        typeof record.slug !== "string" ||
        typeof record.name !== "string" ||
        typeof record.price_cents !== "number" ||
        !Number.isFinite(record.price_cents)
      ) {
        continue;
      }

      items.push({
        productId: record.productId,
        slug: record.slug,
        name: record.name,
        price_cents: record.price_cents,
        image_url:
          typeof record.image_url === "string" ? record.image_url : null,
        quantity: clampQuantity(
          typeof record.quantity === "number" ? record.quantity : 1,
        ),
      });
    }

    return items.length > 0 ? items : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

function getSnapshot(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedItems = parseCart(raw);
    }

    return cachedItems;
  } catch {
    return cachedItems;
  }
}

function getServerSnapshot(): CartItem[] {
  return EMPTY_CART;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function writeCart(items: CartItem[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage can be unavailable (private mode/quota); the change is
    // dropped safely instead of breaking the page.
  } finally {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const add = useCallback(
    (item: Omit<CartItem, "quantity">, quantity = 1) => {
      const nextQuantity = clampQuantity(quantity);
      const current = getSnapshot();
      const existing = current.find(
        (entry) => entry.productId === item.productId,
      );

      const next = existing
        ? current.map((entry) =>
            entry.productId === item.productId
              ? {
                  ...entry,
                  quantity: clampQuantity(entry.quantity + nextQuantity),
                }
              : entry,
          )
        : [...current, { ...item, quantity: nextQuantity }];

      writeCart(next);
    },
    [],
  );

  const remove = useCallback((productId: string) => {
    const next = getSnapshot().filter(
      (entry) => entry.productId !== productId,
    );
    writeCart(next);
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      writeCart(
        getSnapshot().filter((entry) => entry.productId !== productId),
      );
      return;
    }

    writeCart(
      getSnapshot().map((entry) =>
        entry.productId === productId
          ? { ...entry, quantity: clampQuantity(quantity) }
          : entry,
      ),
    );
  }, []);

  const clear = useCallback(() => {
    writeCart([]);
  }, []);

  const count = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({ items, count, add, remove, setQuantity, clear }),
    [items, count, add, remove, setQuantity, clear],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }

  return context;
}

export function useCartCount(): number {
  const context = useContext(CartContext);

  return context?.count ?? 0;
}
