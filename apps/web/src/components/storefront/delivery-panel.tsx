"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { formatCents } from "@/lib/money";

const ZIP_COOKIE = "zf-zip";

type DeliveryResult = {
  available: boolean;
  fee_cents: number | null;
  free_over_cents: number | null;
};

type DeliveryOutcome = {
  result: DeliveryResult | null;
  error: string;
};

function readZipCookie(): string | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${ZIP_COOKIE}=`));

    return match ? match.split("=")[1] : null;
  } catch {
    return null;
  }
}

function subscribeCookie(callback: () => void) {
  window.addEventListener("focus", callback);

  return () => window.removeEventListener("focus", callback);
}

function getZipSnapshot(): string | null {
  return readZipCookie();
}

function getZipServerSnapshot(): string | null {
  return null;
}

function formatFee(cents: number): string {
  return formatCents(cents).replace(/\.00$/, "");
}

function deliveryMessage(
  zip: string,
  result: DeliveryResult,
  priceCents: number,
): string {
  if (!result.available) {
    return `We don't deliver to ${zip} yet.`;
  }

  const qualifiesForFreeDelivery =
    result.fee_cents === 0 ||
    (result.free_over_cents !== null &&
      priceCents >= result.free_over_cents);

  if (qualifiesForFreeDelivery) {
    return `Delivering to ${zip}: Free delivery`;
  }

  if (result.fee_cents !== null) {
    return `Delivering to ${zip}: ${formatFee(result.fee_cents)} delivery`;
  }

  return `Delivering to ${zip}: delivery available`;
}

async function requestDelivery(zip: string): Promise<DeliveryOutcome> {
  try {
    const response = await fetch("/api/zip-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip }),
    });

    if (!response.ok) {
      return {
        result: null,
        error:
          response.status === 400
            ? "Enter a 5-digit US ZIP code."
            : "We couldn't check that ZIP. Please try again.",
      };
    }

    const data: unknown = await response.json().catch(() => null);

    if (typeof data !== "object" || data === null) {
      return {
        result: null,
        error: "We couldn't check that ZIP. Please try again.",
      };
    }

    const record = data as {
      available?: unknown;
      fee_cents?: unknown;
      free_over_cents?: unknown;
    };

    return {
      result: {
        available: record.available === true,
        fee_cents:
          typeof record.fee_cents === "number" ? record.fee_cents : null,
        free_over_cents:
          typeof record.free_over_cents === "number"
            ? record.free_over_cents
            : null,
      },
      error: "",
    };
  } catch {
    return {
      result: null,
      error: "We couldn't check that ZIP. Please try again.",
    };
  }
}

export function DeliveryPanel({ priceCents }: { priceCents: number }) {
  const savedZip = useSyncExternalStore(
    subscribeCookie,
    getZipSnapshot,
    getZipServerSnapshot,
  );
  const [zip, setZip] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!savedZip) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const outcome = await requestDelivery(savedZip);

      if (cancelled) {
        return;
      }

      setResult(outcome.result);
      setError(outcome.error);
      setZip(savedZip);
      setValue(savedZip);
    })();

    return () => {
      cancelled = true;
    };
  }, [savedZip]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = value.trim();

    if (!/^\d{5}$/.test(next)) {
      setError("Enter a 5-digit US ZIP code.");
      return;
    }

    setBusy(true);
    setError("");
    setEditing(false);

    const outcome = await requestDelivery(next);

    setResult(outcome.result);
    setError(outcome.error);
    setZip(next);
    setValue(next);
    setBusy(false);
  }

  const activeZip = editing ? null : zip ?? savedZip;
  const showResult = Boolean(activeZip && result && !busy);
  const checking = Boolean(
    !busy && !showResult && !error && activeZip && !result,
  );

  return (
    <section className="zf-delivery" aria-labelledby="pdp-delivery-title">
      <h2 id="pdp-delivery-title" className="zf-delivery__title">
        Delivery
      </h2>

      {busy || checking ? (
        <p className="zf-delivery__note" aria-live="polite">
          Checking delivery…
        </p>
      ) : showResult && activeZip && result ? (
        <div className="zf-delivery__result">
          <p className="zf-delivery__message">
            {deliveryMessage(activeZip, result, priceCents)}
          </p>
          <button
            type="button"
            className="zf-delivery__change"
            onClick={() => {
              setEditing(true);
              setValue(activeZip);
            }}
          >
            Change ZIP
          </button>
        </div>
      ) : (
        <form className="zf-delivery__form" onSubmit={onSubmit}>
          <label className="zf-delivery__label" htmlFor="pdp-zip">
            Enter your ZIP code
          </label>
          <div className="zf-delivery__row">
            <input
              id="pdp-zip"
              name="zip"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              placeholder="e.g. 10001"
              value={value}
              disabled={busy}
              onChange={(event) => {
                setValue(event.target.value.replace(/\D/g, ""));
                setError("");
              }}
            />
            <button type="submit" disabled={busy}>
              Check
            </button>
          </div>
          {error ? (
            <p className="zf-delivery__note zf-delivery__note--error">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
