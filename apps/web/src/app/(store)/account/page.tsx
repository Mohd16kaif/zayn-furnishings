import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/lib/authServer";
import { fetchCustomerOrders } from "@/lib/orderServer";
import { EMPTY_ORDER_LIST } from "@/lib/orderTypes";
import { AccountClient } from "@/components/storefront/account-client";
import { SignIn } from "@/components/storefront/sign-in";

export const instant = false;

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
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
              <li aria-current="page">Account</li>
            </ol>
          </nav>

          <div className="zf-account__signin">
            <div className="zf-account__signin-intro">
              <p className="zf-eyebrow">Your account</p>
              <h1 className="zf-account__title">Sign in to your account</h1>
              <p className="zf-lede">
                Use the phone number on your orders. We will text you a
                one-time code — no password to remember.
              </p>
            </div>
            <SignIn heading="Account sign in" />
          </div>
        </div>
      </section>
    );
  }

  const orders = (await fetchCustomerOrders(1)) ?? {
    ...EMPTY_ORDER_LIST,
    page: 1,
  };

  return <AccountClient customer={customer} initialOrders={orders} />;
}
