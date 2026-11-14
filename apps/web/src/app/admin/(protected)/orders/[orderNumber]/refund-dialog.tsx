"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { REFUND_REASON_OPTIONS } from "@/lib/adminOrderLabels";
import { formatCents } from "@/lib/money";

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

type RefundMode = "full" | "partial";
type RefundReason = (typeof REFUND_REASON_OPTIONS)[number]["value"];

function newRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return "00000000-0000-4000-8000-000000000000";
}

function parseDollarAmount(value: string): number | null {
  const normalized = value.trim().replace(/[$,]/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const dollars = Number(normalized);

  if (!Number.isFinite(dollars)) {
    return null;
  }

  return Math.round(dollars * 100);
}

function friendlyRefundError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) {
      return "Your session has expired. Please sign in again.";
    }

    if (error.status === 403) {
      return "Only the owner can issue refunds.";
    }

    if (error.status === 429) {
      return "Too many refund attempts. Please wait a minute and try again.";
    }

    if (error.status === 503) {
      return "Refunds are temporarily unavailable. Please try again later.";
    }

    return error.message || "We could not complete the refund.";
  }

  return "We could not complete the refund. Please try again.";
}

export function RefundDialog({
  orderNumber,
  remainingCents,
  onClose,
  onRefunded,
}: {
  orderNumber: string;
  remainingCents: number;
  onClose: () => void;
  onRefunded: (amountCents: number) => void | Promise<void>;
}) {
  const titleId = useId();
  const noteId = useId();
  const amountId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [requestId] = useState(() => newRequestId());
  const [mode, setMode] = useState<RefundMode>("full");
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] =
    useState<RefundReason>("requested_by_customer");
  const [note, setNote] = useState("");
  const [restock, setRestock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [saving, onClose]);

  const partialCents =
    mode === "partial" ? parseDollarAmount(amountInput) : remainingCents;
  const amountCents = partialCents ?? 0;
  const amountValid =
    partialCents !== null &&
    Number.isInteger(partialCents) &&
    partialCents >= 1 &&
    partialCents <= remainingCents;
  const noteValid = note.trim().length >= 1 && note.trim().length <= 500;
  const canSubmit =
    !saving &&
    requestId !== "" &&
    amountValid &&
    noteValid &&
    remainingCents > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await adminFetch(
        `/admin/orders/${encodeURIComponent(orderNumber)}/refund`,
        {
          method: "POST",
          json: {
            request_id: requestId,
            ...(mode === "partial"
              ? { amount_cents: partialCents }
              : {}),
            reason,
            note: note.trim(),
            restock: mode === "full" ? restock : false,
          },
        },
      );

      await onRefunded(amountCents);
    } catch (refundError) {
      setError(friendlyRefundError(refundError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-stone-900">
          Refund order {orderNumber}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Still refundable: {formatCents(remainingCents)}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset disabled={saving}>
            <legend className="text-sm font-medium text-stone-800">
              Refund type
            </legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-2 text-sm text-stone-800">
                <input
                  type="radio"
                  name="refund-mode"
                  value="full"
                  checked={mode === "full"}
                  onChange={() => setMode("full")}
                  className="mt-1"
                />
                <span>
                  Full refund (remaining {formatCents(remainingCents)})
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-stone-800">
                <input
                  type="radio"
                  name="refund-mode"
                  value="partial"
                  checked={mode === "partial"}
                  onChange={() => setMode("partial")}
                  className="mt-1"
                />
                <span>Partial refund</span>
              </label>
            </div>
          </fieldset>

          {mode === "partial" ? (
            <div>
              <label
                htmlFor={amountId}
                className="block text-sm font-medium text-stone-800"
              >
                Refund amount in dollars
              </label>
              <input
                id={amountId}
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="0.00"
                disabled={saving}
                className={`${inputClass} mt-1`}
              />
              <p className="mt-1 text-xs text-stone-500">
                Enter an amount from $0.01 up to{" "}
                {formatCents(remainingCents)}.
              </p>
            </div>
          ) : null}

          <div>
            <label
              htmlFor="refund-reason"
              className="block text-sm font-medium text-stone-800"
            >
              Reason
            </label>
            <select
              id="refund-reason"
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as RefundReason)
              }
              disabled={saving}
              className={`${inputClass} mt-1`}
            >
              {REFUND_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={noteId}
              className="block text-sm font-medium text-stone-800"
            >
              Note
            </label>
            <textarea
              id={noteId}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={saving}
              placeholder="Why is this refund being issued?"
              className={`${inputClass} mt-1`}
            />
            <p className="mt-1 text-xs text-stone-500">
              {note.trim().length} of 500 characters
            </p>
          </div>

          {mode === "full" ? (
            <div>
              <label className="flex items-start gap-2 text-sm font-medium text-stone-800">
                <input
                  type="checkbox"
                  checked={restock}
                  onChange={(event) => setRestock(event.target.checked)}
                  disabled={saving}
                  className="mt-1"
                />
                <span>Put the items back in stock</span>
              </label>
              <p className="mt-1 pl-6 text-xs leading-5 text-stone-500">
                Tick this only if the items are physically back with you
              </p>
            </div>
          ) : null}

          {amountValid ? (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-800">
              This sends {formatCents(amountCents)} back to the customer&apos;s
              card. This cannot be undone.
            </p>
          ) : (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800">
              {mode === "partial" && amountInput.trim()
                ? `Enter a valid amount up to ${formatCents(
                    remainingCents,
                  )}.`
                : "Enter the refund amount to continue."}
            </p>
          )}

          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? "Sending refund..."
                : `Refund ${amountValid ? formatCents(amountCents) : ""}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
