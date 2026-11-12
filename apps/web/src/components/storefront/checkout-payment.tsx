"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Appearance, Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { formatCents } from "@/lib/money";
import { useTheme } from "../design/theme-provider";

export type CreatedOrder = {
  order_number: string;
  client_secret: string;
  total_cents: number;
  breakdown: {
    subtotal_cents: number;
    discount_cents: number;
    delivery_fee_cents: number;
    tax_cents: number;
    total_cents: number;
    discount_code: string | null;
  };
};

type CheckoutPaymentProps = {
  order: CreatedOrder;
  stripePromise: Promise<Stripe | null> | null;
};

function PaymentForm({ order }: { order: CreatedOrder }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (guard.current) {
      return;
    }

    if (!stripe || !elements) {
      setError("Payment is still loading. Please try again in a moment.");
      return;
    }

    guard.current = true;
    setProcessing(true);
    setError("");

    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/order/${order.order_number}`,
        },
        redirect: "if_required",
      });

      if (result.error) {
        setError(
          result.error.message ||
            "That payment could not be completed. Please try another card.",
        );
        return;
      }

      const status = result.paymentIntent?.status;

      if (
        status === "succeeded" ||
        status === "processing" ||
        status === "requires_capture"
      ) {
        router.push(`/order/${order.order_number}`);
        return;
      }

      setError(
        "We could not confirm the payment. Please try again or use another card.",
      );
    } catch {
      setError(
        "We could not reach the payment service. Check your connection and try again.",
      );
    } finally {
      guard.current = false;
      setProcessing(false);
    }
  }

  return (
    <form className="zf-payment" onSubmit={onSubmit}>
      <PaymentElement />

      <div className="zf-form__feedback" aria-live="polite">
        {error ? (
          <p className="zf-form__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        className="zf-btn zf-btn--primary zf-payment__submit"
        disabled={processing || !stripe}
        aria-busy={processing}
      >
        {processing
          ? "Processing payment…"
          : `Pay ${formatCents(order.total_cents)}`}
      </button>

      <p className="zf-payment__note">
        Payments are encrypted and processed securely by Stripe. Your card
        details never touch our servers.
      </p>
    </form>
  );
}

export function CheckoutPayment({
  order,
  stripePromise,
}: CheckoutPaymentProps) {
  const { theme } = useTheme();

  const appearance = useMemo<Appearance>(
    () => ({
      theme: theme === "dark" ? "night" : "stripe",
      variables: {
        colorPrimary: theme === "dark" ? "#d9b66f" : "#8e6a2a",
        colorBackground: theme === "dark" ? "#1b1510" : "#ffffff",
        colorText: theme === "dark" ? "#f3ebdd" : "#2a1d14",
        colorDanger: "#c0392b",
        fontFamily:
          '"Jost", ui-sans-serif, system-ui, -apple-system, sans-serif',
        borderRadius: "2px",
        spacingUnit: "4px",
      },
    }),
    [theme],
  );

  if (!stripePromise) {
    return (
      <div className="zf-payment zf-payment--unconfigured" role="status">
        <p className="zf-payment__unconfigured-title">
          Payments are not configured
        </p>
        <p>
          Secure card payments are not available right now. Please contact us
          to complete your order.
        </p>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret: order.client_secret, appearance }}
    >
      <PaymentForm order={order} />
    </Elements>
  );
}
