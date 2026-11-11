"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "error";

export type ToastMessage = {
  kind: ToastKind;
  message: string;
};

export function useAdminToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<number | null>(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setToast(null);
  }, []);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    setToast({ kind, message });
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, 4500);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return { toast, showToast, dismissToast };
}

export function AdminToast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) {
    return null;
  }

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`fixed right-4 top-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
        toast.kind === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-green-200 bg-green-50 text-green-800"
      }`}
    >
      <p className="min-w-0 flex-1 leading-5">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="rounded p-1 text-xs font-semibold opacity-70 hover:opacity-100"
      >
        Close
      </button>
    </div>
  );
}
