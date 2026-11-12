import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/lib/authServer";
import { fetchCustomerOrder } from "@/lib/orderServer";
import { OrderConfirmation } from "@/components/storefront/order-confirmation";
import { SignIn } from "@/components/storefront/sign-in";
import { StoreNotFound } from "@/components/storefront/store-not-found";

export const instant = false;

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const customer = await getCurrentCustomer();

  if (!customer) {
    return (
      <section className="zf-account">
        <div className="zf-container">
          <nav className="zf-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-current="page">Order</li>
            </ol>
          </nav>

          <div className="zf-account__signin">
            <div className="zf-account__signin-intro">
              <p className="zf-eyebrow">Order {orderNumber}</p>
              <h1 className="zf-account__title">Sign in to view your order</h1>
              <p className="zf-lede">
                For your privacy, order details are only shown to the
                signed-in customer who placed the order.
              </p>
            </div>
            <SignIn heading="Sign in to view this order" />
          </div>
        </div>
      </section>
    );
  }

  const result = await fetchCustomerOrder(orderNumber);

  if (result.status === "not_found" || result.status === "unauthorized") {
    return <StoreNotFound />;
  }

  if (result.status === "error") {
    return (
      <section className="zf-order">
        <div className="zf-container">
          <div className="zf-checkout__blocker" role="alert">
            <h1>We could not load that order</h1>
            <p>
              The order service did not respond. Please refresh or try again
              in a moment.
            </p>
            <div className="zf-checkout__blocker-actions">
              <a className="zf-btn zf-btn--primary" href={`/order/${orderNumber}`}>
                Refresh
              </a>
              <Link className="zf-btn zf-btn--ghost" href="/account">
                Back to account
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return <OrderConfirmation initialOrder={result.order} />;
}
