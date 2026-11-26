"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AdminApiError,
  adminFetch,
  type AdminCategory,
  type AdminPriceChangeApplied,
  type AdminPriceChangeParams,
  type AdminPriceChangePreview,
  type AdminPriceChangeSummary,
  type AdminPriceChangeUndoResult,
} from "@/lib/adminApi";
import { dollarsToCents } from "@/lib/adminMoney";
import { formatCents } from "@/lib/money";
import { revalidateStorefront } from "@/lib/actions/revalidateStorefront";
import {
  AdminToast,
  useAdminToast,
} from "@/components/admin/admin-toast";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

const fieldClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";
const labelClass =
  "block text-xs font-medium uppercase tracking-wide text-stone-500";

type Step = 1 | 2 | 3 | 4;

type StatusChoice = "active_draft" | "active" | "draft" | "all";

type Direction = "increase" | "decrease";

type ValueType = "percent" | "amount";

const STATUS_OPTIONS: Array<{
  value: StatusChoice;
  label: string;
}> = [
  {
    value: "active_draft",
    label: "Active and draft products (recommended)",
  },
  { value: "active", label: "Active products only" },
  { value: "draft", label: "Draft products only" },
  { value: "all", label: "All products, including archived" },
];

const ROUNDING_OPTIONS: Array<{
  value: AdminPriceChangeParams["rounding"];
  label: string;
  hint: string;
}> = [
  {
    value: "none",
    label: "No rounding (exact cents)",
    hint: "Prices keep the exact cents from the change.",
  },
  {
    value: "nearest_dollar",
    label: "Nearest dollar",
    hint: "For example, $11.49 becomes $11.00 and $11.50 becomes $12.00.",
  },
  {
    value: "end_99",
    label: "End in 99 cents",
    hint: "Rounds up to the next price ending in 99 cents. For example, $11.00 becomes $11.99.",
  },
  {
    value: "end_00_up",
    label: "End in 00, round up",
    hint: "Rounds up to the next whole dollar. For example, $11.01 becomes $12.00.",
  },
];

function statusesForChoice(choice: StatusChoice): AdminPriceChangeParams["statuses"] {
  if (choice === "active") {
    return ["active"];
  }

  if (choice === "draft") {
    return ["draft"];
  }

  if (choice === "all") {
    return ["active", "draft", "archived"];
  }

  return ["active", "draft"];
}

function formatDifference(cents: number): string {
  if (cents === 0) {
    return "$0.00";
  }

  return `${cents > 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.fields) {
      const first = Object.values(error.fields)[0];

      if (first) {
        return first;
      }
    }

    if (error.status === 403) {
      return "Only the owner can change prices. Sign in as the owner and try again.";
    }

    if (error.status === 401) {
      return "Your session has expired. Sign in again.";
    }

    if (error.status === 409) {
      return "These prices changed since you previewed. Preview again and confirm the new numbers.";
    }
  }

  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function plural(count: number, singular: string, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function statusBadge(status: AdminPriceChangePreview["rows"][number]["status"]) {
  if (status === "ok") {
    return "bg-green-100 text-green-800";
  }

  if (status === "blocked") {
    return "bg-red-100 text-red-800";
  }

  return "bg-stone-100 text-stone-600";
}

function statusLabel(status: AdminPriceChangePreview["rows"][number]["status"]) {
  if (status === "ok") {
    return "Will change";
  }

  if (status === "blocked") {
    return "Skipped";
  }

  return "No change";
}

export function PriceChangePanel({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: AdminCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [scope, setScope] = useState("all");
  const [statusChoice, setStatusChoice] =
    useState<StatusChoice>("active_draft");
  const [direction, setDirection] = useState<Direction>("increase");
  const [valueType, setValueType] = useState<ValueType>("percent");
  const [amountInput, setAmountInput] = useState("10");
  const [applyTo, setApplyTo] =
    useState<AdminPriceChangeParams["apply_to"]>("regular");
  const [rounding, setRounding] =
    useState<AdminPriceChangeParams["rounding"]>("none");
  const [preview, setPreview] = useState<AdminPriceChangePreview | null>(
    null,
  );
  const [previewParams, setPreviewParams] =
    useState<AdminPriceChangeParams | null>(null);
  const [applied, setApplied] = useState<AdminPriceChangeApplied | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [confirmUndoBatch, setConfirmUndoBatch] =
    useState<AdminPriceChangeSummary | null>(null);
  const [history, setHistory] = useState<AdminPriceChangeSummary[]>([]);
  const [historyStatus, setHistoryStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [historyError, setHistoryError] = useState("");
  const { toast, showToast, dismissToast } = useAdminToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus("loading");
    setHistoryError("");

    try {
      const data = await adminFetch<AdminPriceChangeSummary[]>(
        "/admin/price-changes",
      );
      setHistory(data);
      setHistoryStatus("ready");
    } catch (loadError) {
      setHistoryError(errorMessage(loadError));
      setHistoryStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();

      if (!cancelled) {
        await loadHistory();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [open, loadHistory]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !confirmApplyOpen &&
        !confirmUndoBatch
      ) {
        event.preventDefault();
        onCloseRef.current();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, confirmApplyOpen, confirmUndoBatch]);

  const categoryOptions = useMemo(() => {
    const topLevel = categories
      .filter((category) => !category.parent_id)
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.name.localeCompare(right.name),
      );
    const options: AdminCategory[] = [];

    for (const parent of topLevel) {
      options.push(parent);
      options.push(
        ...categories
          .filter((category) => category.parent_id === parent.id)
          .sort(
            (left, right) =>
              left.sort_order - right.sort_order ||
              left.name.localeCompare(right.name),
          ),
      );
    }

    return options;
  }, [categories]);

  function buildParams():
    | { params: AdminPriceChangeParams; error?: undefined }
    | { params?: undefined; error: string } {
    const raw = amountInput.trim();

    if (!raw) {
      return {
        error:
          valueType === "percent"
            ? "Enter a percentage."
            : "Enter an amount in dollars.",
      };
    }

    const parsedScope: AdminPriceChangeParams["scope"] =
      scope === "all"
        ? { type: "all" }
        : {
            type: "category",
            category_id: scope,
            include_children: true,
          };

    if (valueType === "percent") {
      const value = Number(raw);

      if (!Number.isFinite(value) || value < 0.01 || value > 90) {
        return { error: "Enter a percentage from 0.01 to 90." };
      }

      if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-9) {
        return { error: "Use at most 2 decimal places." };
      }

      return {
        params: {
          scope: parsedScope,
          statuses: statusesForChoice(statusChoice),
          mode:
            direction === "increase"
              ? "percent_increase"
              : "percent_decrease",
          value,
          apply_to: applyTo,
          rounding,
        },
      };
    }

    const cents = dollarsToCents(raw);

    if (cents === null || cents < 1) {
      return { error: "Enter an amount of at least $0.01." };
    }

    if (cents > 100_000_000) {
      return { error: "Enter $1,000,000.00 or less." };
    }

    return {
      params: {
        scope: parsedScope,
        statuses: statusesForChoice(statusChoice),
        mode:
          direction === "increase"
            ? "amount_increase"
            : "amount_decrease",
        value: cents,
        apply_to: applyTo,
        rounding,
      },
    };
  }

  async function runPreview(override?: AdminPriceChangeParams) {
    const result = override
      ? ({ params: override } as const)
      : buildParams();

    if (!result.params) {
      setError(result.error);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const data = await adminFetch<AdminPriceChangePreview>(
        "/admin/price-changes/preview",
        { method: "POST", json: result.params },
      );
      setPreview(data);
      setPreviewParams(result.params);
      setStep(3);

      if (data.counts.ok === 0) {
        setNotice(
          "No products would change with these settings. Review the skipped rows or go back and adjust.",
        );
      }
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setBusy(false);
    }
  }

  async function applyNow() {
    if (!preview || !previewParams || preview.counts.ok === 0) {
      return;
    }

    setConfirmApplyOpen(false);
    setBusy(true);
    setError("");

    try {
      const data = await adminFetch<AdminPriceChangeApplied>(
        "/admin/price-changes/apply",
        {
          method: "POST",
          json: {
            params: previewParams,
            preview_token: preview.preview_token,
          },
        },
      );
      setApplied(data);
      setPreview(null);
      setPreviewParams(null);
      setStep(4);
      showToast(
        "success",
        `Prices changed for ${plural(data.item_count, "product")}. The storefront will refresh shortly.`,
      );
      await revalidateStorefront();
      onChanged();
      await loadHistory();
    } catch (applyError) {
      if (
        applyError instanceof AdminApiError &&
        applyError.status === 409
      ) {
        setError(
          "Prices changed since you previewed. The preview was refreshed with the latest prices. Check the new numbers and apply again.",
        );
        showToast(
          "info",
          "Prices changed since your preview. The preview was refreshed.",
        );
        await runPreview(previewParams);
      } else {
        setError(errorMessage(applyError));
      }
    } finally {
      setBusy(false);
    }
  }

  async function undoNow() {
    if (!confirmUndoBatch) {
      return;
    }

    const batch = confirmUndoBatch;
    setConfirmUndoBatch(null);
    setBusy(true);
    setError("");

    try {
      const result = await adminFetch<AdminPriceChangeUndoResult>(
        `/admin/price-changes/${batch.id}/undo`,
        { method: "POST" },
      );
      const summary = `Restored ${plural(
        result.restored_count,
        "price",
      )}. ${plural(
        result.skipped_count,
        "product",
      )} changed since and ${result.skipped_count === 1 ? "was" : "were"} skipped.`;

      setNotice(summary);
      showToast("success", summary);
      await revalidateStorefront();
      onChanged();
      await loadHistory();
    } catch (undoError) {
      if (
        undoError instanceof AdminApiError &&
        undoError.status === 409
      ) {
        setError(
          "This price change was already undone. The history has been refreshed.",
        );
        await loadHistory();
      } else {
        setError(errorMessage(undoError));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return null;
  }

  const activeStep: Step = confirmApplyOpen ? 4 : step;
  const steps: Array<{ number: Step; label: string }> = [
    { number: 1, label: "Where" },
    { number: 2, label: "Change" },
    { number: 3, label: "Preview" },
    { number: 4, label: "Confirm" },
  ];
  const roundingHint =
    ROUNDING_OPTIONS.find((option) => option.value === rounding)?.hint ?? "";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/40 p-2 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-change-title"
        className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
              Products
            </p>
            <h2
              id="price-change-title"
              className="mt-1 text-xl font-semibold text-stone-900"
            >
              Change prices
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Preview first, then apply. Every change is saved in Recent price
              changes and can be undone.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <ol className="flex flex-wrap gap-2" aria-label="Price change steps">
            {steps.map((entry) => {
              const current = entry.number === activeStep;
              const done = entry.number < activeStep;

              return (
                <li
                  key={entry.number}
                  aria-current={current ? "step" : undefined}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    current
                      ? "bg-stone-900 text-white"
                      : done
                        ? "bg-green-100 text-green-800"
                        : "border border-stone-200 text-stone-600"
                  }`}
                >
                  {entry.number}. {entry.label}
                </li>
              );
            })}
          </ol>

          <div aria-live="polite" className="mt-4 space-y-2">
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                role="status"
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
              >
                {notice}
              </p>
            ) : null}
          </div>

          {step === 1 ? (
            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="price-change-scope" className={labelClass}>
                  Where
                </label>
                <select
                  id="price-change-scope"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  className={fieldClass}
                >
                  <option value="all">All products</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.parent_id ? `— ${category.name}` : category.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  Choosing a category also includes its subcategories.
                </p>
              </div>

              <div>
                <label htmlFor="price-change-status" className={labelClass}>
                  Product status
                </label>
                <select
                  id="price-change-status"
                  value={statusChoice}
                  onChange={(event) =>
                    setStatusChoice(event.target.value as StatusChoice)
                  }
                  className={fieldClass}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="price-change-direction"
                    className={labelClass}
                  >
                    Direction
                  </label>
                  <select
                    id="price-change-direction"
                    value={direction}
                    onChange={(event) =>
                      setDirection(event.target.value as Direction)
                    }
                    className={fieldClass}
                  >
                    <option value="increase">Increase prices</option>
                    <option value="decrease">Decrease prices</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="price-change-type" className={labelClass}>
                    Type
                  </label>
                  <select
                    id="price-change-type"
                    value={valueType}
                    onChange={(event) =>
                      setValueType(event.target.value as ValueType)
                    }
                    className={fieldClass}
                  >
                    <option value="percent">Percent</option>
                    <option value="amount">Dollars</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="price-change-value" className={labelClass}>
                    {valueType === "percent"
                      ? "Percent"
                      : "Amount (USD)"}
                  </label>
                  <input
                    id="price-change-value"
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                    placeholder={valueType === "percent" ? "10" : "12.50"}
                    className={fieldClass}
                  />
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    {valueType === "percent"
                      ? "Enter 0.01 to 90 with up to 2 decimal places."
                      : "Enter dollars, for example 12.50. The amount is stored in cents."}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="price-change-apply-to"
                    className={labelClass}
                  >
                    Apply to
                  </label>
                  <select
                    id="price-change-apply-to"
                    value={applyTo}
                    onChange={(event) =>
                      setApplyTo(
                        event.target.value as AdminPriceChangeParams["apply_to"],
                      )
                    }
                    className={fieldClass}
                  >
                    <option value="regular">Regular price</option>
                    <option value="sale">Sale price</option>
                    <option value="both">Both regular and sale prices</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="price-change-rounding" className={labelClass}>
                  Rounding
                </label>
                <select
                  id="price-change-rounding"
                  value={rounding}
                  onChange={(event) =>
                    setRounding(
                      event.target
                        .value as AdminPriceChangeParams["rounding"],
                    )
                  }
                  className={fieldClass}
                >
                  {ROUNDING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {roundingHint}
                </p>
              </div>

              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs leading-5 text-stone-600">
                Prices must be at least $1.00 and no more than $1,000,000.00.
                A sale price must stay below the regular price. Up to 500
                products can change in one batch.
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={busy}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Checking..." : "Preview changes"}
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 && preview ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-green-800">
                    Will change
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-green-900">
                    {preview.counts.ok}
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-600">
                    No change
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-stone-900">
                    {preview.counts.unchanged}
                  </p>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-red-800">
                    Skipped
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-red-900">
                    {preview.counts.blocked}
                  </p>
                </div>
              </div>

              <p className="text-sm text-stone-700">
                {plural(preview.counts.ok, "product")} will change;{" "}
                {plural(preview.counts.unchanged, "product")} will stay the
                same; {plural(preview.counts.blocked, "product")} will be
                skipped.
              </p>

              {preview.counts.blocked > 0 ? (
                <p
                  role="status"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  Some products will be skipped. Review the reasons in the
                  table before applying.
                </p>
              ) : null}

              {preview.counts.unchanged > 0 ? (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  Some products already match the new price, or have no sale
                  price to change.
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-3 font-medium">Product</th>
                      <th className="px-3 py-3 font-medium">Old price</th>
                      <th className="px-3 py-3 font-medium">New price</th>
                      <th className="px-3 py-3 font-medium">Difference</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const priceDifference =
                        row.new_price_cents - row.old_price_cents;
                      const saleDifference =
                        row.new_sale_price_cents !== null ||
                        row.old_sale_price_cents !== null
                          ? (row.new_sale_price_cents ?? 0) -
                            (row.old_sale_price_cents ?? 0)
                          : 0;

                      return (
                        <tr
                          key={row.product_id}
                          className="border-t border-stone-100 align-top"
                        >
                          <td className="px-3 py-3">
                            <p className="font-medium text-stone-900">
                              {row.name}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-stone-700">
                            <p>{formatCents(row.old_price_cents)}</p>
                            {row.old_sale_price_cents !== null ? (
                              <p className="mt-1 text-xs text-red-700">
                                Sale {formatCents(row.old_sale_price_cents)}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-stone-900">
                            <p className="font-medium">
                              {formatCents(row.new_price_cents)}
                            </p>
                            {row.new_sale_price_cents !== null ? (
                              <p className="mt-1 text-xs font-medium text-red-700">
                                Sale {formatCents(row.new_sale_price_cents)}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-stone-700">
                            {row.status === "ok" ? (
                              <>
                                <p>{formatDifference(priceDifference)}</p>
                                {saleDifference !== 0 ? (
                                  <p className="mt-1 text-xs">
                                    Sale {formatDifference(saleDifference)}
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="text-stone-400">—</p>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(
                                row.status,
                              )}`}
                            >
                              {statusLabel(row.status)}
                            </span>
                            {row.reason ? (
                              <p className="mt-1 max-w-xs text-xs leading-5 text-stone-500">
                                {row.reason}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep(2);
                    setPreview(null);
                    setPreviewParams(null);
                  }}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmApplyOpen(true)}
                  disabled={busy || preview.counts.ok === 0}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply prices
                </button>
              </div>
            </div>
          ) : null}

          {step === 4 && applied ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4">
                <h3 className="text-lg font-semibold text-green-900">
                  Prices changed
                </h3>
                <p className="mt-1 text-sm leading-6 text-green-800">
                  {plural(applied.item_count, "product")} changed. The storefront
                  will refresh within a few seconds.
                </p>
                <p className="mt-2 text-sm leading-6 text-green-800">
                  {applied.summary}
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}

          <section className="mt-8 border-t border-stone-200 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-stone-900">
                Recent price changes
              </h3>
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
              >
                Refresh
              </button>
            </div>

            {historyStatus === "loading" ? (
              <p className="mt-3 text-sm text-stone-500">
                Loading recent price changes...
              </p>
            ) : null}

            {historyStatus === "error" ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {historyError}
              </div>
            ) : null}

            {historyStatus === "ready" && history.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                No price changes yet.
              </p>
            ) : null}

            {historyStatus === "ready" && history.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {history.map((batch) => (
                  <li
                    key={batch.id}
                    className="rounded-lg border border-stone-200 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900">
                          {batch.summary}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          {plural(batch.item_count, "product")} &middot;{" "}
                          {formatWhen(batch.created_at)} &middot;{" "}
                          {batch.admin.name ?? batch.admin.email ?? "Admin"}
                        </p>
                        {batch.undone_at ? (
                          <p className="mt-1 text-xs font-medium text-stone-500">
                            Undone
                            {batch.undone_by?.name ||
                            batch.undone_by?.email
                              ? ` by ${
                                  batch.undone_by.name ??
                                  batch.undone_by.email
                                }`
                              : ""}
                            .
                          </p>
                        ) : null}
                      </div>
                      {!batch.undone_at ? (
                        <button
                          type="button"
                          onClick={() => setConfirmUndoBatch(batch)}
                          className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                        >
                          Undo
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={dismissToast} />

      <ConfirmDialog
        open={confirmApplyOpen}
        title={`Change prices for ${plural(
          preview?.counts.ok ?? 0,
          "product",
        )}?`}
        description={
          preview
            ? `${plural(
                preview.counts.ok,
                "product",
              )} will change. You can undo this later from Recent price changes.`
            : ""
        }
        confirmLabel="Apply new prices"
        busy={busy}
        onCancel={() => setConfirmApplyOpen(false)}
        onConfirm={() => void applyNow()}
      />

      <ConfirmDialog
        open={confirmUndoBatch !== null}
        title="Undo this price change?"
        description={
          confirmUndoBatch
            ? `${plural(
                confirmUndoBatch.item_count,
                "product",
              )} will be restored to the prices before "${confirmUndoBatch.summary}". Products that changed since then will be skipped.`
            : ""
        }
        confirmLabel="Undo price change"
        busy={busy}
        onCancel={() => setConfirmUndoBatch(null)}
        onConfirm={() => void undoNow()}
      />
    </div>
  );
}
