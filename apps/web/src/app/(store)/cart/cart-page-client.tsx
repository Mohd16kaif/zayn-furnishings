"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type { PublicCategoryNode } from "@zayn/shared";
import {
  useCart,
  type CartItem,
} from "@/components/design/cart-provider";
import { SmartImage } from "@/components/design/smart-image";
import { CategorySuggestions } from "@/components/storefront/category-suggestions";
import { EmptyState } from "@/components/storefront/empty-state";
import type {
  CartValidatedItem,
  CartValidation,
} from "@/lib/publicApi";
import {
  formatDeliveryFee,
  getZipServerSnapshot,
  getZipSnapshot,
  requestDelivery,
  subscribeZipCookie,
  type DeliveryResult,
} from "@/lib/deliveryClient";
import { formatCents } from "@/lib/money";

const MAX_QUANTITY = 10;

type CartPageClientProps = {
  categories: PublicCategoryNode[];
};

type CartRow = {
  item: CartItem;
  displayName: string;
  slug: string;
  imageUrl: string | null;
  unitPriceCents: number;
  originalPriceCents: number | null;
  onSale: boolean;
  unavailable: boolean;
  soldOut: boolean;
  included: boolean;
  lineTotalCents: number;
};

function quantityLabel(quantity: number): string {
  return `${quantity} ${quantity === 1 ? "piece" : "pieces"}`;
}

export function CartPageClient({ categories }: CartPageClientProps) {
  const { items, setQuantity, remove } = useCart();
  const [validation, setValidation] = useState<CartValidation | null>(null);
  const [validatedBody, setValidatedBody] = useState("");
  const [validationError, setValidationError] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const requestBody = useMemo(
    () =>
      items.length === 0
        ? ""
        : JSON.stringify({
            items: items.map((item) => ({
              product_id: item.productId,
              quantity: item.quantity,
            })),
          }),
    [items],
  );

  useEffect(() => {
    if (!requestBody) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/cart-validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: controller.signal,
        });
        const data: unknown = await response.json().catch(() => null);

        if (
          !response.ok ||
          typeof data !== "object" ||
          data === null
        ) {
          throw new Error("Cart validation failed");
        }

        setValidation(data as CartValidation);
        setValidatedBody(requestBody);
        setValidationError(false);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setValidationError(true);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestBody]);

  const current = Boolean(
    validation && !validationError && validatedBody === requestBody,
  );
  const pending = Boolean(requestBody) && !validationError && !current;

  const rows = useMemo<CartRow[]>(() => {
    const serverById = new Map(
      (validation?.items ?? []).map((item) => [item.id, item]),
    );

    return items.map((item) => {
      const server: CartValidatedItem | null =
        validation && !validationError
          ? serverById.get(item.productId) ?? null
          : null;

      if (server) {
        const onSale =
          server.sale_price_cents !== null &&
          server.sale_price_cents < server.price_cents;
        const soldOut = !server.in_stock;

        return {
          item,
          displayName: server.name,
          slug: server.slug,
          imageUrl: server.primary_image_url,
          unitPriceCents: server.effective_price_cents,
          originalPriceCents: onSale ? server.price_cents : null,
          onSale,
          unavailable: false,
          soldOut,
          included: !soldOut,
          lineTotalCents: server.effective_price_cents * item.quantity,
        };
      }

      if (current) {
        return {
          item,
          displayName: item.name,
          slug: item.slug,
          imageUrl: item.image_url,
          unitPriceCents: item.price_cents,
          originalPriceCents: null,
          onSale: false,
          unavailable: true,
          soldOut: false,
          included: false,
          lineTotalCents: 0,
        };
      }

      return {
        item,
        displayName: item.name,
        slug: item.slug,
        imageUrl: item.image_url,
        unitPriceCents: item.price_cents,
        originalPriceCents: null,
        onSale: false,
        unavailable: false,
        soldOut: false,
        included: true,
        lineTotalCents: item.price_cents * item.quantity,
      };
    });
  }, [items, validation, validationError, current]);

  const subtotalCents = rows.reduce(
    (total, row) => total + (row.included ? row.lineTotalCents : 0),
    0,
  );
  const unavailableCount = rows.filter(
    (row) => row.unavailable || row.soldOut,
  ).length;
  const totalPieces = items.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const savedZip = useSyncExternalStore(
    subscribeZipCookie,
    getZipSnapshot,
    getZipServerSnapshot,
  );
  const [zip, setZip] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryResult | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [zipValue, setZipValue] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [zipEditing, setZipEditing] = useState(false);

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

      setDelivery(outcome.result);
      setDeliveryError(outcome.error);
      setZip(savedZip);
      setZipValue(savedZip);
    })();

    return () => {
      cancelled = true;
    };
  }, [savedZip]);

  const activeZip = zipEditing ? null : zip ?? savedZip;
  const deliveryAvailable = Boolean(activeZip && delivery?.available);
  const freeOverCents =
    validation?.free_delivery_threshold_cents ??
    delivery?.free_over_cents ??
    null;

  let deliveryFeeCents = 0;

  if (deliveryAvailable && delivery) {
    if (delivery.fee_cents === 0) {
      deliveryFeeCents = 0;
    } else if (
      freeOverCents !== null &&
      subtotalCents >= freeOverCents
    ) {
      deliveryFeeCents = 0;
    } else {
      deliveryFeeCents = delivery.fee_cents ?? 0;
    }
  }

  const estimatedTotalCents = subtotalCents + deliveryFeeCents;

  function changeQuantity(row: CartRow, next: number) {
    const value = Math.min(MAX_QUANTITY, Math.max(1, next));

    if (value === row.item.quantity) {
      return;
    }

    setQuantity(row.item.productId, value);
    setAnnouncement(
      `Quantity for ${row.displayName} is now ${value}.`,
    );
  }

  function removeRow(row: CartRow) {
    remove(row.item.productId);
    setAnnouncement(`${row.displayName} removed from cart.`);
  }

  function startEditingZip() {
    setZipEditing(true);
    setZipValue(activeZip ?? "");
    setDeliveryError("");
  }

  async function onSubmitZip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = zipValue.trim();

    if (!/^\d{5}$/.test(next)) {
      setDeliveryError("Enter a 5-digit US ZIP code.");
      return;
    }

    setZip(next);
    setZipEditing(false);
    setZipBusy(true);
    setDeliveryError("");
    setDelivery(null);

    const outcome = await requestDelivery(next);

    setDelivery(outcome.result);
    setDeliveryError(outcome.error);
    setZipValue(next);
    setZipBusy(false);
    setAnnouncement(
      outcome.result?.available
        ? `Delivery ZIP set to ${next}.`
        : "Delivery ZIP could not be checked.",
    );
  }

  function renderDelivery() {
    if (zipBusy) {
      return (
        <p className="zf-cart-summary__delivery-note" aria-live="polite">
          Checking delivery
          {activeZip ? ` to ${activeZip}` : ""}…
        </p>
      );
    }

    if (!activeZip) {
      return (
        <form className="zf-delivery__form" onSubmit={onSubmitZip}>
          <label className="zf-sr-only" htmlFor="cart-zip">
            ZIP code for delivery estimate
          </label>
          <div className="zf-delivery__row">
            <input
              id="cart-zip"
              name="zip"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              placeholder="e.g. 10001"
              value={zipValue}
              onChange={(event) => {
                setZipValue(event.target.value.replace(/\D/g, ""));
                setDeliveryError("");
              }}
            />
            <button type="submit">Check</button>
          </div>
          <p className="zf-cart-summary__delivery-note">
            Enter a ZIP code to calculate delivery.
          </p>
          {deliveryError ? (
            <p className="zf-cart-summary__delivery-note zf-cart-summary__delivery-note--error">
              {deliveryError}
            </p>
          ) : null}
        </form>
      );
    }

    if (deliveryError) {
      return (
        <div className="zf-cart-summary__delivery">
          <p className="zf-cart-summary__delivery-note zf-cart-summary__delivery-note--error">
            {deliveryError}
          </p>
          <button
            type="button"
            className="zf-delivery__change"
            onClick={startEditingZip}
          >
            Try another ZIP
          </button>
        </div>
      );
    }

    if (!delivery) {
      return (
        <p className="zf-cart-summary__delivery-note" aria-live="polite">
          Checking delivery to {activeZip}…
        </p>
      );
    }

    if (!delivery.available) {
      return (
        <div className="zf-cart-summary__delivery">
          <p className="zf-cart-summary__delivery-note">
            Delivery to {activeZip}: not available
          </p>
          <button
            type="button"
            className="zf-delivery__change"
            onClick={startEditingZip}
          >
            Change ZIP
          </button>
        </div>
      );
    }

    return (
      <div className="zf-cart-summary__delivery">
        <p className="zf-cart-summary__delivery-note">
          Delivery to {activeZip}:{" "}
          {deliveryFeeCents === 0
            ? "Free"
            : formatDeliveryFee(deliveryFeeCents)}
        </p>
        <button
          type="button"
          className="zf-delivery__change"
          onClick={startEditingZip}
        >
          Change ZIP
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <section className="zf-cart-page">
        <div className="zf-container">
          <nav className="zf-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-current="page">Cart</li>
            </ol>
          </nav>

          <div className="zf-cart-page__head">
            <h1 className="zf-cart-page__title">Your cart</h1>
          </div>

          <EmptyState
            title="Your cart is empty"
            body="Browse the collection and add the pieces you love."
          >
            {categories.length > 0 ? (
              <CategorySuggestions
                categories={categories}
                heading="Shop by room"
              />
            ) : null}
            <Link className="zf-btn zf-btn--primary" href="/">
              Continue shopping
            </Link>
          </EmptyState>
        </div>
      </section>
    );
  }

  return (
    <section className="zf-cart-page">
      <div className="zf-container">
        <nav className="zf-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li aria-current="page">Cart</li>
          </ol>
        </nav>

        <div className="zf-cart-page__head">
          <h1 className="zf-cart-page__title">Your cart</h1>
          <p className="zf-cart-page__count">
            {quantityLabel(totalPieces)}
          </p>
        </div>

        {validationError ? (
          <p className="zf-cart-page__notice" role="status">
            We couldn&apos;t refresh prices right now. Your saved cart is
            shown and prices will be refreshed shortly.
          </p>
        ) : pending ? (
          <p className="zf-cart-page__refreshing" aria-live="polite">
            Refreshing prices…
          </p>
        ) : null}

        {unavailableCount > 0 ? (
          <p className="zf-cart-page__notice">
            Some items are no longer available and are excluded from your
            subtotal.
          </p>
        ) : null}

        <p className="zf-sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        <div className="zf-cart-page__layout">
          <div className="zf-cart-page__items">
            <ul className="zf-cart-list">
              {rows.map((row) => (
                <li className="zf-cart-item" key={row.item.productId}>
                  <div className="zf-cart-item__media">
                    <SmartImage
                      src={row.imageUrl ?? undefined}
                      alt={`${row.displayName} product photo`}
                      sizes="(max-width: 640px) 88px, 120px"
                      tone={2}
                      label={row.displayName}
                    />
                  </div>

                  <div className="zf-cart-item__body">
                    <div className="zf-cart-item__head">
                      <Link
                        className="zf-cart-item__name"
                        href={`/p/${row.slug}`}
                      >
                        {row.displayName}
                      </Link>
                      {row.unavailable ? (
                        <span className="zf-cart-item__status">
                          No longer available
                        </span>
                      ) : row.soldOut ? (
                        <span className="zf-cart-item__status">
                          Sold out
                        </span>
                      ) : null}
                    </div>

                    <div className="zf-cart-item__price">
                      {row.unavailable ? (
                        <span className="zf-cart-item__muted">
                          Price unavailable
                        </span>
                      ) : (
                        <>
                          {row.onSale &&
                          row.originalPriceCents !== null ? (
                            <>
                              <strong>
                                {formatCents(row.unitPriceCents)}
                              </strong>
                              <s>
                                {formatCents(row.originalPriceCents)}
                              </s>
                            </>
                          ) : (
                            <strong>
                              {formatCents(row.unitPriceCents)}
                            </strong>
                          )}
                          <span className="zf-cart-item__each">each</span>
                        </>
                      )}
                    </div>

                    <div className="zf-cart-item__actions">
                      <div
                        className="zf-qty-stepper"
                        role="group"
                        aria-label={`Quantity for ${row.displayName}`}
                      >
                        <button
                          type="button"
                          className="zf-qty-stepper__btn"
                          aria-label={`Decrease quantity for ${row.displayName}`}
                          disabled={row.item.quantity <= 1}
                          onClick={() =>
                            changeQuantity(row, row.item.quantity - 1)
                          }
                        >
                          −
                        </button>
                        <span className="zf-qty-stepper__value">
                          {row.item.quantity}
                        </span>
                        <button
                          type="button"
                          className="zf-qty-stepper__btn"
                          aria-label={`Increase quantity for ${row.displayName}`}
                          disabled={row.item.quantity >= MAX_QUANTITY}
                          onClick={() =>
                            changeQuantity(row, row.item.quantity + 1)
                          }
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        className="zf-cart-item__remove"
                        aria-label={`Remove ${row.displayName} from cart`}
                        onClick={() => removeRow(row)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="zf-cart-item__line">
                    <span className="zf-sr-only">Line total</span>
                    {row.unavailable || row.soldOut ? (
                      <span className="zf-cart-item__muted">Excluded</span>
                    ) : (
                      <strong>{formatCents(row.lineTotalCents)}</strong>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <aside
            className="zf-cart-summary"
            aria-labelledby="cart-summary-title"
          >
            <h2 id="cart-summary-title" className="zf-cart-summary__title">
              Order summary
            </h2>

            <dl className="zf-cart-summary__rows">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatCents(subtotalCents)}</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>{renderDelivery()}</dd>
              </div>
            </dl>

            <p className="zf-cart-summary__tax">
              Sales tax is calculated at checkout
            </p>

            <div className="zf-cart-summary__total">
              <span>Estimated total</span>
              <strong>{formatCents(estimatedTotalCents)}</strong>
            </div>

            <div className="zf-cart-summary__actions">
              {/* TODO(checkout): enable once the checkout flow ships. */}
              <button
                type="button"
                className="zf-btn zf-btn--primary zf-cart-summary__checkout"
                disabled
                aria-describedby="checkout-helper"
              >
                Proceed to checkout
              </button>
              <p
                id="checkout-helper"
                className="zf-cart-summary__helper"
              >
                Secure checkout opens soon
              </p>
              <Link className="zf-cart-summary__continue" href="/">
                Continue shopping
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
