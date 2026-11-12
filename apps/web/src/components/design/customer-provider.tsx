"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionCustomer } from "@/lib/customer";

type CustomerContextValue = {
  customer: SessionCustomer | null;
  setCustomer: (customer: SessionCustomer | null) => void;
  signOut: () => Promise<boolean>;
};

const CustomerContext = createContext<CustomerContextValue | null>(null);

export function CustomerProvider({
  initialCustomer,
  children,
}: {
  initialCustomer: SessionCustomer | null;
  children: ReactNode;
}) {
  const [customer, setCustomer] = useState<SessionCustomer | null>(
    initialCustomer,
  );

  const signOut = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        return false;
      }

      setCustomer(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ customer, setCustomer, signOut }),
    [customer, signOut],
  );

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer(): CustomerContextValue {
  const context = useContext(CustomerContext);

  if (!context) {
    throw new Error("useCustomer must be used inside a CustomerProvider");
  }

  return context;
}
