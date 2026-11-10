"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  adminFetch,
  AdminApiError,
  type AdminDeliveryCoverage,
  type AdminDeliveryZone,
  type AdminMe,
  type AdminStoreSettings,
} from "@/lib/adminApi";
import {
  centsToDollarsInput,
  dollarsToCents,
  formatAdminDollars,
} from "@/lib/adminMoney";
import {
  requestDelivery,
  type DeliveryResult,
} from "@/lib/deliveryClient";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

const helpClass = "mt-1 text-xs leading-5 text-stone-500";

function zipRange(zone: AdminDeliveryZone): string {
  return `${zone.zip_start}–${zone.zip_end}`;
}

function coverageLabel(
  ranges: AdminDeliveryCoverage["ranges"],
): string {
  return ranges
    .map((range) => `${range.zip_start}–${range.zip_end}`)
    .join(", ");
}

export function DeliveryClient() {
  const [zones, setZones] = useState<AdminDeliveryZone[]>([]);
  const [coverage, setCoverage] = useState<AdminDeliveryCoverage | null>(
    null,
  );
  const [settings, setSettings] = useState<AdminStoreSettings | null>(
    null,
  );
  const [role, setRole] = useState<AdminMe["role"] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDeliveryZone | null>(null);

  const [testZip, setTestZip] = useState("");
  const [testTotal, setTestTotal] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<DeliveryResult | null>(
    null,
  );

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");

    try {
      const [zonesData, coverageData, settingsData, me] =
        await Promise.all([
          adminFetch<AdminDeliveryZone[]>("/admin/delivery-zones"),
          adminFetch<AdminDeliveryCoverage>(
            "/admin/delivery-zones/coverage",
          ),
          adminFetch<AdminStoreSettings>("/admin/settings"),
          adminFetch<AdminMe>("/admin/me"),
        ]);

      setZones(zonesData);
      setCoverage(coverageData);
      setSettings(settingsData);
      setRole(me.role);
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load delivery zones.",
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();

      if (!cancelled) {
        await load();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const isStaff = role === "staff";
  const storeDefault =
    settings?.free_delivery_threshold_cents ?? null;
  const storeDefaultLabel =
    storeDefault === null
      ? "Store default (no free delivery)"
      : `Store default (${formatAdminDollars(storeDefault)})`;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
    setNotice("");
  }

  function openEdit(zone: AdminDeliveryZone) {
    setEditing(zone);
    setFormOpen(true);
    setNotice("");
  }

  async function toggleActive(zone: AdminDeliveryZone) {
    setBusy(true);
    setActionError("");
    setNotice("");

    try {
      await adminFetch(`/admin/delivery-zones/${zone.id}`, {
        method: "PATCH",
        json: { is_active: !zone.is_active },
      });
      await load();
      setNotice(
        zone.is_active
          ? "Delivery zone deactivated."
          : "Delivery zone activated.",
      );
    } catch (toggleError) {
      setActionError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update the delivery zone.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(zone: AdminDeliveryZone) {
    const confirmed = window.confirm(
      `Delete the "${zone.name}" delivery zone? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setActionError("");
    setNotice("");

    try {
      await adminFetch(`/admin/delivery-zones/${zone.id}`, {
        method: "DELETE",
      });
      await load();
      setNotice("Delivery zone deleted.");
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the delivery zone.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestError("");
    setTestResult(null);

    const zip = testZip.trim();

    if (!/^\d{5}$/.test(zip)) {
      setTestError("Enter a 5-digit ZIP code.");
      return;
    }

    const subtotalCents = testTotal.trim()
      ? dollarsToCents(testTotal)
      : 0;

    if (subtotalCents === null) {
      setTestError("Enter a valid cart total.");
      return;
    }

    setTestBusy(true);
    const outcome = await requestDelivery(zip, subtotalCents);
    setTestResult(outcome.result);
    setTestError(outcome.error);
    setTestBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Store
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Delivery
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Delivery fees and free-delivery thresholds by ZIP range.
          </p>
        </div>
        {!isStaff ? (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            Add delivery zone
          </button>
        ) : null}
      </div>

      {isStaff ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          You can view delivery zones. Only the owner can make changes.
        </p>
      ) : null}

      <div aria-live="polite" className="mt-4 space-y-2">
        {notice ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {actionError}
          </p>
        ) : null}
      </div>

      {status === "loading" ? (
        <p className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center text-sm text-stone-500">
          Loading delivery zones...
        </p>
      ) : null}

      {status === "error" ? (
        <div className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Try again
          </button>
        </div>
      ) : null}

      {status === "ready" && coverage && settings ? (
        <div
          className={`mt-6 rounded-xl border p-4 text-sm ${
            coverage.ranges.length > 0
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <p className="font-medium">
            {coverage.ranges.length > 0
              ? "These ZIP codes are not covered:"
              : "All US ZIP codes are covered"}
          </p>
          {coverage.ranges.length > 0 ? (
            <p className="mt-1 break-words">
              {coverageLabel(coverage.ranges)}
            </p>
          ) : null}
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {zones.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              No delivery zones yet. Add one to start calculating
              delivery.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Zone</th>
                    <th className="px-4 py-3">ZIP range</th>
                    <th className="px-4 py-3">Fee</th>
                    <th className="px-4 py-3">Free over</th>
                    <th className="px-4 py-3">Status</th>
                    {!isStaff ? (
                      <th className="px-4 py-3 text-right">Actions</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {zones.map((zone) => {
                    const usesOwnFreeAmount =
                      zone.free_over_cents !== null &&
                      zone.free_over_cents !== storeDefault;

                    return (
                      <tr key={zone.id} className="align-top">
                        <td className="px-4 py-3 font-medium text-stone-900">
                          {zone.name}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {zipRange(zone)}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {formatAdminDollars(zone.fee_cents)}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          <span>
                            {zone.free_over_cents === null
                              ? storeDefaultLabel
                              : formatAdminDollars(
                                  zone.free_over_cents,
                                )}
                          </span>
                          {usesOwnFreeAmount ? (
                            <span className="mt-1 block text-xs text-amber-700">
                              This zone uses its own free-delivery
                              amount.
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {zone.is_active ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                              Active
                            </span>
                          ) : (
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                              Inactive
                            </span>
                          )}
                        </td>
                        {!isStaff ? (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(zone)}
                                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void toggleActive(zone)}
                                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {zone.is_active
                                  ? "Deactivate"
                                  : "Activate"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void remove(zone)}
                                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-900">
            Test a ZIP
          </h2>
          <p className={helpClass}>
            Uses the live public delivery check with the same rules
            customers see.
          </p>
          <form
            onSubmit={testDelivery}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="w-full sm:max-w-[12rem]">
              <label
                htmlFor="test-zip"
                className="block text-sm font-medium text-stone-800"
              >
                ZIP code
              </label>
              <input
                id="test-zip"
                inputMode="numeric"
                maxLength={5}
                value={testZip}
                onChange={(event) =>
                  setTestZip(
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                className={inputClass}
                placeholder="10001"
              />
            </div>
            <div className="w-full sm:max-w-[12rem]">
              <label
                htmlFor="test-total"
                className="block text-sm font-medium text-stone-800"
              >
                Cart total
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                  $
                </span>
                <input
                  id="test-total"
                  inputMode="decimal"
                  value={testTotal}
                  onChange={(event) =>
                    setTestTotal(event.target.value)
                  }
                  className={`${inputClass} mt-0 pl-7`}
                  placeholder="1999"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={testBusy}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testBusy ? "Checking..." : "Test ZIP"}
            </button>
          </form>

          {testError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {testError}
            </p>
          ) : null}

          {testResult ? (
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              {!testResult.available ? (
                <p>We don&apos;t deliver to this ZIP yet.</p>
              ) : (
                <div className="space-y-1">
                  <p>
                    Zone:{" "}
                    <span className="font-medium text-stone-900">
                      {testResult.zone?.name ?? "—"}
                    </span>
                  </p>
                  <p>
                    Delivery:{" "}
                    <span className="font-medium text-stone-900">
                      {testResult.is_free
                        ? "Free"
                        : formatAdminDollars(testResult.fee_cents)}
                    </span>
                  </p>
                  <p>
                    Free over:{" "}
                    <span className="font-medium text-stone-900">
                      {testResult.free_over_cents === null
                        ? "No free-delivery amount"
                        : formatAdminDollars(
                            testResult.free_over_cents,
                          )}
                    </span>
                  </p>
                  {testResult.amount_to_free_cents !== null &&
                  testResult.amount_to_free_cents > 0 ? (
                    <p>
                      Add{" "}
                      <span className="font-medium text-stone-900">
                        {formatAdminDollars(
                          testResult.amount_to_free_cents,
                        )}
                      </span>{" "}
                      more for free delivery.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {formOpen && settings ? (
        <ZoneForm
          zone={editing}
          storeDefault={storeDefault}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            await load();
            setNotice(
              editing
                ? "Delivery zone updated."
                : "Delivery zone created.",
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ZoneForm({
  zone,
  storeDefault,
  onClose,
  onSaved,
}: {
  zone: AdminDeliveryZone | null;
  storeDefault: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [zipStart, setZipStart] = useState(zone?.zip_start ?? "");
  const [zipEnd, setZipEnd] = useState(zone?.zip_end ?? "");
  const [feeDollars, setFeeDollars] = useState(
    centsToDollarsInput(zone?.fee_cents ?? 0),
  );
  const [useStoreDefault, setUseStoreDefault] = useState(
    zone ? zone.free_over_cents === null : true,
  );
  const [freeOverDollars, setFreeOverDollars] = useState(
    centsToDollarsInput(zone?.free_over_cents ?? null),
  );
  const [isActive, setIsActive] = useState(zone?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {},
  );

  const customFreeOverCents = dollarsToCents(freeOverDollars);
  const customFreeDiffers =
    !useStoreDefault &&
    customFreeOverCents !== null &&
    customFreeOverCents !== storeDefault;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFieldErrors({});

    if (!/^\d{5}$/.test(zipStart.trim())) {
      setFieldErrors({ zip_start: "Enter a 5-digit ZIP code." });
      setSaving(false);
      return;
    }

    if (!/^\d{5}$/.test(zipEnd.trim())) {
      setFieldErrors({ zip_end: "Enter a 5-digit ZIP code." });
      setSaving(false);
      return;
    }

    if (zipStart.trim() > zipEnd.trim()) {
      setFieldErrors({
        zip_end: "ZIP start must be less than or equal to ZIP end.",
      });
      setSaving(false);
      return;
    }

    const feeCents = dollarsToCents(feeDollars);

    if (feeCents === null) {
      setFieldErrors({ fee_cents: "Enter a delivery fee." });
      setSaving(false);
      return;
    }

    const freeOverCents = useStoreDefault
      ? null
      : dollarsToCents(freeOverDollars);

    if (!useStoreDefault && freeOverCents === null) {
      setFieldErrors({
        free_over_cents: "Enter a free-delivery amount.",
      });
      setSaving(false);
      return;
    }

    const payload = {
      name: name.trim(),
      zip_start: zipStart.trim(),
      zip_end: zipEnd.trim(),
      fee_cents: feeCents,
      free_over_cents: freeOverCents,
      is_active: isActive,
    };

    try {
      if (zone) {
        await adminFetch(`/admin/delivery-zones/${zone.id}`, {
          method: "PATCH",
          json: payload,
        });
      } else {
        await adminFetch("/admin/delivery-zones", {
          method: "POST",
          json: payload,
        });
      }

      await onSaved();
    } catch (saveError) {
      if (saveError instanceof AdminApiError) {
        setFieldErrors(saveError.fields ?? {});
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the delivery zone.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-form-title"
        className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="zone-form-title"
            className="text-lg font-semibold text-stone-900"
          >
            {zone ? "Edit delivery zone" : "Add delivery zone"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label
              htmlFor="zone-name"
              className="block text-sm font-medium text-stone-800"
            >
              Zone name
            </label>
            <input
              id="zone-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="zone-zip-start"
                className="block text-sm font-medium text-stone-800"
              >
                ZIP start
              </label>
              <input
                id="zone-zip-start"
                inputMode="numeric"
                maxLength={5}
                value={zipStart}
                onChange={(event) =>
                  setZipStart(
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.zip_start)}
              />
              {fieldErrors.zip_start ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.zip_start}
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor="zone-zip-end"
                className="block text-sm font-medium text-stone-800"
              >
                ZIP end
              </label>
              <input
                id="zone-zip-end"
                inputMode="numeric"
                maxLength={5}
                value={zipEnd}
                onChange={(event) =>
                  setZipEnd(event.target.value.replace(/\D/g, ""))
                }
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.zip_end)}
              />
              {fieldErrors.zip_end ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.zip_end}
                </p>
              ) : null}
            </div>
          </div>

          <p className={helpClass}>
            If ranges overlap, the smaller (more specific) range is
            used.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="zone-fee"
                className="block text-sm font-medium text-stone-800"
              >
                Delivery fee
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                  $
                </span>
                <input
                  id="zone-fee"
                  inputMode="decimal"
                  value={feeDollars}
                  onChange={(event) =>
                    setFeeDollars(event.target.value)
                  }
                  className={`${inputClass} mt-0 pl-7`}
                  placeholder="99"
                  aria-invalid={Boolean(fieldErrors.fee_cents)}
                />
              </div>
              {fieldErrors.fee_cents ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.fee_cents}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="block text-sm font-medium text-stone-800"
                htmlFor="zone-free-over"
              >
                Free delivery over
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                  $
                </span>
                <input
                  id="zone-free-over"
                  inputMode="decimal"
                  value={freeOverDollars}
                  onChange={(event) =>
                    setFreeOverDollars(event.target.value)
                  }
                  className={`${inputClass} mt-0 pl-7`}
                  placeholder={
                    storeDefault === null
                      ? "No free delivery"
                      : centsToDollarsInput(storeDefault)
                  }
                  disabled={useStoreDefault}
                  aria-invalid={Boolean(fieldErrors.free_over_cents)}
                />
              </div>
              {fieldErrors.free_over_cents ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.free_over_cents}
                </p>
              ) : null}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={useStoreDefault}
              onChange={(event) => {
                setUseStoreDefault(event.target.checked);
                if (event.target.checked) {
                  setFreeOverDollars("");
                }
              }}
              className="h-4 w-4 rounded border-stone-300"
            />
            Use the store-wide free-delivery amount
          </label>
          <p className={helpClass}>
            {storeDefault === null
              ? "The store currently has no free-delivery amount."
              : `Store-wide amount: ${formatAdminDollars(storeDefault)}.`}
          </p>

          {customFreeDiffers ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This zone uses its own free-delivery amount.
            </p>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300"
            />
            Active
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save zone"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
