"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/design/cart-provider";
import { formatCents } from "@/lib/money";
import {
  formatCustomerOrderStatus,
  formatDeliveryDate,
  formatDeliveryStatusSentence,
  formatOrderDate,
  isCustomerOrderDetail,
  type CustomerOrderDetail,
} from "@/lib/orderTypes";

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 15;

type OrderConfirmationProps = {
  initialOrder: CustomerOrderDetail;
};

function addressLines(order: CustomerOrderDetail): string[] {
  return [
    order.address.name,
    order.address.line1,
    order.address.line2,
    [order.address.city, order.address.state, order.address.zip]
      .filter(Boolean)
      .join(", "),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export function OrderConfirmation({ initialOrder }: OrderConfirmationProps) {
  const { clear } = useCart();
  const [order, setOrder] = useState<CustomerOrderDetail>(initialOrder);
  const [polling, setPolling] = useState(initialOrder.status === "pending");
  const [timedOut, setTimedOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const clearedRef = useRef(false);

  useEffect(() => {
    if (order.status === "paid" && !clearedRef.current) {
      clearedRef.current = true;
      clear();
    }
  }, [order.status, clear]);

  useEffect(() => {
    if (!polling) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let busy = false;

    const timer = window.setInterval(() => {
      void (async () => {
        if (cancelled || busy) {
          return;
        }

        busy = true;
        attempts += 1;

        try {
          const response = await fetch(
            `/api/orders/${encodeURIComponent(order.order_number)}`,
          );
          const data: unknown = await response.json().catch(() => null);

          if (
            !cancelled &&
            response.ok &&
            isCustomerOrderDetail(data)
          ) {
            setOrder(data);

            if (data.status !== "pending") {
              setPolling(false);
              setTimedOut(false);
            }
          }
        } catch {
          // Keep polling; the calm fallback appears after the time limit.
        } finally {
          busy = false;
        }

        if (!cancelled && attempts >= POLL_ATTEMPTS) {
          setPolling(false);
          setTimedOut(true);
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, order.order_number]);

  async function refreshStatus() {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    setRefreshError("");

    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(order.order_number)}`,
      );
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok || !isCustomerOrderDetail(data)) {
        setRefreshError(
          "We could not refresh the status. Please try again.",
        );
        return;
      }

      setOrder(data);

      if (data.status === "pending") {
        setTimedOut(false);
        setPolling(true);
      } else {
        setTimedOut(false);
        setPolling(false);
      }
    } catch {
      setRefreshError("We could not refresh the status. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  const paid = order.status === "paid";
  const address = addressLines(order);
  const statusLabel = formatCustomerOrderStatus(order.status);
  const deliveryStatus =
    order.delivery?.status ?? order.delivery_status ?? null;
  const delivery = order.delivery;

  return (
    <section className="zf-order">
      <div className="zf-container">
        <nav className="zf-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <Link href="/account">Account</Link>
            </li>
            <li aria-current="page">{order.order_number}</li>
          </ol>
        </nav>

        <div className="zf-order__head">
          <div>
            <p className="zf-eyebrow">{statusLabel}</p>
            <h1 className="zf-order__title">
              {paid ? "Thank you for your order." : "Your order"}
            </h1>
            <p className="zf-order__number">
              Order {order.order_number} · {formatOrderDate(order.created_at)}
            </p>
          </div>
          <span
            className={`zf-order__status${
              paid ? " zf-order__status--paid" : ""
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="zf-order__layout">
          <div className="zf-order__main">
            {polling ? (
              <div className="zf-order__confirming" role="status">
                <span className="zf-order__spinner" aria-hidden="true" />
                <div>
                  <p className="zf-order__confirming-title">
                    Confirming your payment…
                  </p>
                  <p>
                    This usually takes a few seconds. Please keep this page
                    open.
                  </p>
                </div>
              </div>
            ) : null}

            {timedOut && order.status === "pending" ? (
              <div className="zf-order__pending" role="status">
                <p className="zf-order__confirming-title">
                  We are still confirming your payment; you will not be
                  charged twice.
                </p>
                <p>
                  You can safely refresh the status below. If it does not
                  update, your bank may still be processing it.
                </p>
                <button
                  type="button"
                  className="zf-btn zf-btn--ghost"
                  onClick={() => void refreshStatus()}
                  disabled={refreshing}
                  aria-busy={refreshing}
                >
                  {refreshing ? "Refreshing…" : "Refresh status"}
                </button>
              </div>
            ) : null}

            {refreshError ? (
              <p className="zf-form__error" role="alert">
                {refreshError}
              </p>
            ) : null}

            <div className="zf-order__section">
              <h2>Items</h2>
              <ul className="zf-order__items">
                {order.items.map((item, index) => (
                  <li
                    key={`${item.product_id ?? item.name}-${index}`}
                    className="zf-order__item"
                  >
                    <div>
                      <p className="zf-order__item-name">{item.name}</p>
                      {item.sku ? (
                        <p className="zf-order__item-sku">{item.sku}</p>
                      ) : null}
                    </div>
                    <span>× {item.quantity}</span>
                    <strong>{formatCents(item.line_total_cents)}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="zf-order__section">
              <h2>Delivery</h2>
              {deliveryStatus ? (
                <p className="zf-order__delivery-status">
                  Delivery status:{" "}
                  <strong>
                    {formatDeliveryStatusSentence(deliveryStatus)}
                  </strong>
                </p>
              ) : null}
              {delivery ? (
                <dl className="zf-order__delivery-details">
                  {delivery.partner_name ? (
                    <div>
                      <dt>Delivery company</dt>
                      <dd>{delivery.partner_name}</dd>
                    </div>
                  ) : null}
                  {delivery.scheduled_date ? (
                    <div>
                      <dt>Scheduled</dt>
                      <dd>
                        {formatDeliveryDate(delivery.scheduled_date)}
                      </dd>
                    </div>
                  ) : null}
                  {delivery.time_window ? (
                    <div>
                      <dt>Time window</dt>
                      <dd>{delivery.time_window}</dd>
                    </div>
                  ) : null}
                  {delivery.tracking_number ? (
                    <div>
                      <dt>Tracking number</dt>
                      <dd>{delivery.tracking_number}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <address className="zf-order__address">
                {address.map((line, index) => (
                  <span key={`${index}-${line}`}>{line}</span>
                ))}
              </address>
            </div>
          </div>

          <aside
            className="zf-order__summary"
            aria-labelledby="order-summary-title"
          >
            <h2 id="order-summary-title">Order summary</h2>

            <dl className="zf-order__summary-rows">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatCents(order.subtotal_cents)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>
                  {order.discount_cents > 0
                    ? `−${formatCents(order.discount_cents)}`
                    : "—"}
                  {order.discount_code ? (
                    <span className="zf-order__code">
                      {order.discount_code}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>
                  {order.delivery_fee_cents === 0
                    ? "Free"
                    : formatCents(order.delivery_fee_cents)}
                </dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{formatCents(order.tax_cents)}</dd>
              </div>
            </dl>

            <div className="zf-order__summary-total">
              <span>Total</span>
              <strong>{formatCents(order.total_cents)}</strong>
            </div>

            <Link className="zf-btn zf-btn--ghost" href="/account">
              View all orders
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}
