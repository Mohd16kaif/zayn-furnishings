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
  type AdminMe,
  type AdminStoreSettings,
} from "@/lib/adminApi";
import {
  centsToDollarsInput,
  dollarsToCents,
} from "@/lib/adminMoney";
import { revalidateStorefront } from "@/lib/actions/revalidateStorefront";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

const helpClass = "mt-1 text-xs leading-5 text-stone-500";

export function SettingsClient() {
  const [settings, setSettings] = useState<AdminStoreSettings | null>(null);
  const [role, setRole] = useState<AdminMe["role"] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [storeName, setStoreName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [thresholdDollars, setThresholdDollars] = useState("");
  const [noFreeDelivery, setNoFreeDelivery] = useState(false);
  const [showFinancing, setShowFinancing] = useState(false);

  const applySettings = useCallback((data: AdminStoreSettings) => {
    setSettings(data);
    setStoreName(data.store_name);
    setPhone(data.phone);
    setEmail(data.email);
    setThresholdDollars(
      centsToDollarsInput(data.free_delivery_threshold_cents),
    );
    setNoFreeDelivery(data.free_delivery_threshold_cents === null);
    setShowFinancing(data.show_financing);
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");

    try {
      const [settingsData, me] = await Promise.all([
        adminFetch<AdminStoreSettings>("/admin/settings"),
        adminFetch<AdminMe>("/admin/me"),
      ]);

      applySettings(settingsData);
      setRole(me.role);
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load settings.",
      );
      setStatus("error");
    }
  }, [applySettings]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isStaff) {
      return;
    }

    setSaving(true);
    setNotice("");
    setActionError("");
    setFieldErrors({});

    let thresholdCents: number | null = null;

    if (!noFreeDelivery) {
      thresholdCents = dollarsToCents(thresholdDollars);

      if (thresholdCents === null) {
        setFieldErrors({
          free_delivery_threshold_cents:
            "Enter a dollar amount, or choose No free delivery.",
        });
        setSaving(false);
        return;
      }
    }

    try {
      const updated = await adminFetch<AdminStoreSettings>(
        "/admin/settings",
        {
          method: "PATCH",
          json: {
            store_name: storeName.trim(),
            phone: phone.trim(),
            email: email.trim(),
            free_delivery_threshold_cents: thresholdCents,
            show_financing: showFinancing,
          },
        },
      );

      applySettings(updated);
      await revalidateStorefront();
      setNotice("Settings saved.");
    } catch (saveError) {
      if (saveError instanceof AdminApiError) {
        setFieldErrors(saveError.fields ?? {});
      }
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
        Store
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Settings
      </h1>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Store contact details, delivery pricing, and financing options.
      </p>

      {isStaff ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          You can view these settings. Only the owner can make changes.
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
          Loading settings...
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

      {status === "ready" && settings ? (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-6 space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label
              htmlFor="settings-store-name"
              className="block text-sm font-medium text-stone-800"
            >
              Store name
            </label>
            <input
              id="settings-store-name"
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              className={inputClass}
              disabled={isStaff}
              aria-invalid={Boolean(fieldErrors.store_name)}
            />
            {fieldErrors.store_name ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.store_name}
              </p>
            ) : (
              <p className={helpClass}>Shown in the storefront header.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-phone"
                className="block text-sm font-medium text-stone-800"
              >
                Public phone
              </label>
              <input
                id="settings-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={inputClass}
                disabled={isStaff}
                aria-invalid={Boolean(fieldErrors.phone)}
              />
              {fieldErrors.phone ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.phone}
                </p>
              ) : (
                <p className={helpClass}>
                  Digits, spaces, +, ( ) or - only. Leave blank to hide.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="settings-email"
                className="block text-sm font-medium text-stone-800"
              >
                Public email
              </label>
              <input
                id="settings-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                disabled={isStaff}
                aria-invalid={Boolean(fieldErrors.email)}
              />
              {fieldErrors.email ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.email}
                </p>
              ) : (
                <p className={helpClass}>Leave blank to hide.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm font-medium text-stone-800">
              Free delivery
            </p>
            <p className={helpClass}>
              Customers get free delivery when their cart reaches this
              amount. This is a dollar amount, not cents.
            </p>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full sm:max-w-xs">
                <label
                  htmlFor="settings-threshold"
                  className="block text-sm font-medium text-stone-800"
                >
                  Free delivery threshold
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                    $
                  </span>
                  <input
                    id="settings-threshold"
                    inputMode="decimal"
                    value={thresholdDollars}
                    onChange={(event) =>
                      setThresholdDollars(event.target.value)
                    }
                    className={`${inputClass} mt-0 pl-7`}
                    disabled={isStaff || noFreeDelivery}
                    placeholder="1999"
                    aria-invalid={Boolean(
                      fieldErrors.free_delivery_threshold_cents,
                    )}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={noFreeDelivery}
                  onChange={(event) =>
                    setNoFreeDelivery(event.target.checked)
                  }
                  disabled={isStaff}
                  className="h-4 w-4 rounded border-stone-300"
                />
                No free delivery
              </label>
            </div>
            {fieldErrors.free_delivery_threshold_cents ? (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {fieldErrors.free_delivery_threshold_cents}
              </p>
            ) : null}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div>
              <label
                htmlFor="settings-financing"
                className="text-sm font-medium text-stone-800"
              >
                Show financing options
              </label>
              <p className={helpClass}>
                Keep off until financing is set up.
              </p>
            </div>
            <label className="relative mt-1 inline-flex cursor-pointer items-center">
              <input
                id="settings-financing"
                type="checkbox"
                role="switch"
                checked={showFinancing}
                onChange={(event) =>
                  setShowFinancing(event.target.checked)
                }
                disabled={isStaff}
                className="peer sr-only"
                aria-label="Show financing options"
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-11 rounded-full bg-stone-300 transition peer-checked:bg-stone-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stone-900 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition after:content-[''] peer-checked:after:translate-x-5 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
              />
            </label>
          </div>

          {!isStaff ? (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save settings"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
