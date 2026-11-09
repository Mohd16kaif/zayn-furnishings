"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "zf-cart-count";

type CartContextValue = {
  count: number;
};

const CartContext = createContext<CartContextValue | null>(null);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored === null ? 0 : Number.parseInt(stored, 10);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Minimal cart provider. The checkout does not exist yet, so the cart count
 * is read (hydration-safe) from localStorage and stays 0 until checkout
 * exists.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const count = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo(() => ({ count }), [count]);

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}

export function useCartCount(): number {
  const context = useContext(CartContext);

  return context?.count ?? 0;
}
