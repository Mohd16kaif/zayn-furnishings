"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  formatDeliveryFee,
  getZipServerSnapshot,
  getZipSnapshot,
  requestDelivery,
  subscribeZipCookie,
  type DeliveryResult,
} from "@/lib/deliveryClient";

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
    return `Delivering to ${zip}: ${formatDeliveryFee(result.fee_cents)} delivery`;
  }

  return `Delivering to ${zip}: delivery available`;
}

export function DeliveryPanel({ priceCents }: { priceCents: number }) {
  const savedZip = useSyncExternalStore(
    subscribeZipCookie,
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
