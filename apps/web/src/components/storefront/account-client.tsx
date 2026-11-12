"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionCustomer } from "@/lib/customer";
import { formatCents } from "@/lib/money";
import {
  formatOrderDate,
  formatOrderStatus,
  isCustomerOrderList,
  type CustomerOrderList,
} from "@/lib/orderTypes";
import { useCustomer } from "@/components/design/customer-provider";

function OrderRows({ list }: { list: CustomerOrderList }) {
  return (
    <ul className="zf-account__orders">
      {list.orders.map((order) => (
        <li key={order.order_number} className="zf-account__order">
          <Link
            className="zf-account__order-link"
            href={`/order/${order.order_number}`}
          >
            <span className="zf-account__order-number">
              {order.order_number}
            </span>
            <span className="zf-account__order-date">
              {formatOrderDate(order.created_at)}
            </span>
            <span className="zf-account__order-total">
              {formatCents(order.total_cents)}
            </span>
            <span className="zf-account__order-status">
              {formatOrderStatus(order.status)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AccountClient({
  customer,
  initialOrders,
}: {
  customer: SessionCustomer;
  initialOrders: CustomerOrderList;
}) {
  const router = useRouter();
  const { signOut } = useCustomer();
  const [orders, setOrders] = useState<CustomerOrderList>(initialOrders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  async function loadPage(page: number) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/orders?page=${page}`);
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok || !isCustomerOrderList(data)) {
        setError("We could not load more orders. Please try again.");
        return;
      }

      setOrders(data);
    } catch {
      setError("We could not load more orders. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    const ok = await signOut();

    if (ok) {
      router.refresh();
    } else {
      setError("Sign-out failed. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <section className="zf-account">
      <div className="zf-container">
        <nav className="zf-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li aria-current="page">Account</li>
          </ol>
        </nav>

        <div className="zf-account__head">
          <div>
            <p className="zf-eyebrow">Your account</p>
            <h1 className="zf-account__title">Hello, {customer.name || "there"}</h1>
          </div>
          <button
            type="button"
            className="zf-btn zf-btn--ghost zf-account__signout"
            onClick={() => void onSignOut()}
            disabled={signingOut}
            aria-busy={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>

        <dl className="zf-account__details">
          <div>
            <dt>Phone</dt>
            <dd>{customer.phone_masked}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{customer.name || "Not added yet"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{customer.email || "Not added yet"}</dd>
          </div>
        </dl>

        <div className="zf-account__orders-head">
          <h2>Orders</h2>
          {orders.total > 0 ? (
            <p className="zf-account__orders-count">
              {orders.total} order{orders.total === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="zf-form__error" role="alert">
            {error}
          </p>
        ) : null}

        {orders.orders.length === 0 ? (
          <div className="zf-account__empty">
            <p className="zf-account__empty-title">No orders yet</p>
            <p className="zf-account__empty-body">
              When you place an order, you will find it here.
            </p>
            <Link className="zf-btn zf-btn--primary" href="/">
              Browse the collection
            </Link>
          </div>
        ) : (
          <>
            <OrderRows list={orders} />
            {orders.page > 1 || orders.has_more ? (
              <div className="zf-account__pager">
                <button
                  type="button"
                  className="zf-btn zf-btn--ghost"
                  disabled={busy || orders.page <= 1}
                  onClick={() => void loadPage(orders.page - 1)}
                >
                  Previous
                </button>
                <span aria-live="polite">
                  Page {orders.page}
                </span>
                <button
                  type="button"
                  className="zf-btn zf-btn--ghost"
                  disabled={busy || !orders.has_more}
                  onClick={() => void loadPage(orders.page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
