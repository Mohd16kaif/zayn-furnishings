"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  zipMatchesState,
  type PublicDeliveryCheck,
} from "@zayn/shared";
import { useCart } from "@/components/design/cart-provider";
import { useCustomer } from "@/components/design/customer-provider";
import {
  formatDeliveryFee,
  getZipServerSnapshot,
  getZipSnapshot,
  requestDelivery,
  subscribeZipCookie,
} from "@/lib/deliveryClient";
import { formatCents } from "@/lib/money";
import type { CartValidation } from "@/lib/publicApi";
import { US_STATES } from "@/lib/usStates";
import { SignIn } from "./sign-in";
import {
  CheckoutPayment,
  type CreatedOrder,
} from "./checkout-payment";

const publishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey
  ? loadStripe(publishableKey)
  : null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^\d{5}$/;

type AddressFields = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

type AppliedDiscount = {
  code: string;
  discount_cents: number;
};

const EMPTY_ADDRESS: AddressFields = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
};

export function CheckoutClient() {
  const router = useRouter();
  const { items } = useCart();
  const { customer, setCustomer, signOut } = useCustomer();
  const savedZip = useSyncExternalStore(
    subscribeZipCookie,
    getZipSnapshot,
    getZipServerSnapshot,
  );

  const [cartValidation, setCartValidation] =
    useState<CartValidation | null>(null);
  const [validatedBody, setValidatedBody] = useState("");
  const [validationError, setValidationError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const [email, setEmail] = useState(customer?.email ?? "");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [smsChoiceMade, setSmsChoiceMade] = useState(false);
  const [address, setAddress] = useState<AddressFields>({
    ...EMPTY_ADDRESS,
    name: customer?.name ?? "",
  });

  const [delivery, setDelivery] = useState<PublicDeliveryCheck | null>(
    null,
  );
  const [deliveryZip, setDeliveryZip] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [zipChecking, setZipChecking] = useState(false);

  const [discountInput, setDiscountInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] =
    useState<AppliedDiscount | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [applyingDiscount, setApplyingDiscount] = useState(false);

  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [stockIssues, setStockIssues] = useState<string[]>([]);
  const [contactError, setContactError] = useState("");
  const [addressError, setAddressError] = useState("");
  const [zipStateError, setZipStateError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const orderRef = useRef<CreatedOrder | null>(null);
  const autoZipRef = useRef<string | null>(null);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const invalidateOrder = useCallback(() => {
    if (!orderRef.current) {
      return;
    }

    // If contact, address, discount, or cart details change after an order
    // was created, drop the old client_secret and create a fresh order on the
    // next payment attempt. The abandoned pending order is left for the
    // stale-order cancellation script.
    orderRef.current = null;
    setOrder(null);
    setOrderError("");
  }, []);

  const itemsBody = useMemo(
    () =>
      JSON.stringify(
        items.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
      ),
    [items],
  );

  useEffect(() => {
    if (items.length !== 0) {
      return;
    }

    // The cart lives in localStorage, so the first hydration render can see
    // the server-side empty snapshot before the client snapshot arrives.
    // Re-check storage before treating the cart as truly empty.
    const timer = window.setTimeout(() => {
      const raw = window.localStorage.getItem("zf-cart");

      if (!raw || raw === "[]") {
        router.replace("/cart");
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [items.length, router]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/cart-validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: JSON.parse(itemsBody) as Array<{
              product_id: string;
              quantity: number;
            }>,
          }),
          signal: controller.signal,
        });
        const data: unknown = await response.json().catch(() => null);

        if (
          !response.ok ||
          typeof data !== "object" ||
          data === null ||
          !Array.isArray((data as CartValidation).items)
        ) {
          throw new Error("Cart validation failed");
        }

        setCartValidation(data as CartValidation);
        setValidatedBody(itemsBody);
        setValidationError("");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setCartValidation(null);
        setValidationError(
          "We could not refresh your cart. Check your connection and try again.",
        );
      }
    })();

    return () => controller.abort();
  }, [itemsBody, items.length, retryCount, router]);

  useEffect(() => {
    invalidateOrder();
  }, [itemsBody, invalidateOrder]);

  useEffect(() => {
    if (!savedZip) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setAddress((current) =>
        current.zip ? current : { ...current, zip: savedZip },
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [savedZip]);

  const validatedById = useMemo(
    () =>
      new Map(
        (cartValidation?.items ?? []).map((item) => [item.id, item]),
      ),
    [cartValidation],
  );

  const subtotalCents = cartValidation?.subtotal_cents ?? 0;

  const cartIssueNames = useMemo(() => {
    if (!cartValidation) {
      return [];
    }

    return items
      .filter((item) => {
        const server = validatedById.get(item.productId);

        return !server || !server.in_stock;
      })
      .map(
        (item) => validatedById.get(item.productId)?.name ?? item.name,
      );
  }, [items, cartValidation, validatedById]);

  const summaryItems = useMemo(
    () =>
      items.map((item) => {
        const server = validatedById.get(item.productId);

        return {
          productId: item.productId,
          name: server?.name ?? item.name,
          quantity: item.quantity,
          lineTotalCents: server
            ? server.effective_price_cents * item.quantity
            : null,
        };
      }),
    [items, validatedById],
  );

  const checkDeliveryForZip = useCallback(
    async (zipValue: string): Promise<PublicDeliveryCheck | null> => {
      const trimmed = zipValue.trim();

      if (!ZIP_PATTERN.test(trimmed)) {
        setDeliveryError("Enter a 5-digit US ZIP code.");
        return null;
      }

      setZipChecking(true);
      setDeliveryError("");

      const outcome = await requestDelivery(trimmed, subtotalCents);

      setZipChecking(false);

      if (!outcome.result) {
        setDelivery(null);
        setDeliveryZip(null);
        setDeliveryError(
          outcome.error || "We could not check that ZIP. Please try again.",
        );
        return null;
      }

      setDelivery(outcome.result);
      setDeliveryZip(trimmed);

      if (!outcome.result.available) {
        setDeliveryError(`We do not deliver to ${trimmed} yet.`);
      }

      return outcome.result;
    },
    [subtotalCents],
  );

  useEffect(() => {
    if (!savedZip || !cartValidation) {
      return;
    }

    if (address.zip !== savedZip) {
      return;
    }

    const key = `${savedZip}:${subtotalCents}`;

    if (autoZipRef.current === key) {
      return;
    }

    autoZipRef.current = key;
    void checkDeliveryForZip(savedZip);
  }, [
    savedZip,
    cartValidation,
    address.zip,
    subtotalCents,
    checkDeliveryForZip,
  ]);

  const deliveryAvailable = Boolean(
    delivery?.available && deliveryZip === address.zip,
  );

  async function applyDiscount() {
    if (applyingDiscount) {
      return;
    }

    const code = discountInput.trim();

    if (!code) {
      setDiscountError("Enter a discount code.");
      return;
    }

    setApplyingDiscount(true);
    setDiscountError("");

    try {
      const response = await fetch("/api/discount/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
          })),
          discount_code: code,
        }),
      });
      const data: unknown = await response.json().catch(() => null);

      if (response.status === 429) {
        const retryAfter = Number(
          response.headers.get("Retry-After") ?? 0,
        );
        setDiscountError(
          `Too many discount attempts. Try again in ${Math.max(
            1,
            Number.isFinite(retryAfter) ? retryAfter : 30,
          )}s.`,
        );
        return;
      }

      if (
        !response.ok ||
        typeof data !== "object" ||
        data === null
      ) {
        setDiscountError(
          "We could not check that code. Please try again.",
        );
        return;
      }

      const candidate = data as {
        valid?: unknown;
        error?: unknown;
        code?: unknown;
        discount_cents?: unknown;
      };

      if (
        candidate.valid === true &&
        typeof candidate.code === "string" &&
        typeof candidate.discount_cents === "number"
      ) {
        setAppliedDiscount({
          code: candidate.code,
          discount_cents: candidate.discount_cents,
        });
        setDiscountInput(candidate.code);
        invalidateOrder();
        return;
      }

      setAppliedDiscount(null);
      setDiscountError(
        typeof candidate.error === "string"
          ? candidate.error
          : "That discount code is not valid.",
      );
    } catch {
      setDiscountError(
        "We could not check that code. Please try again.",
      );
    } finally {
      setApplyingDiscount(false);
    }
  }

  function removeDiscount() {
    setAppliedDiscount(null);
    setDiscountInput("");
    setDiscountError("");
    invalidateOrder();
  }

  function updateAddress(patch: Partial<AddressFields>) {
    if (patch.zip !== undefined && patch.zip !== address.zip) {
      setDelivery(null);
      setDeliveryZip(null);
      setDeliveryError("");
    }

    setAddress((current) => ({ ...current, ...patch }));
    setAddressError("");
    setZipStateError("");
    invalidateOrder();
  }

  async function onContinueToPayment() {
    if (creatingOrder) {
      return;
    }

    setContactError("");
    setAddressError("");
    setOrderError("");
    setStockIssues([]);

    if (!customer) {
      setContactError("Sign in to continue to payment.");
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setContactError(
        "Enter a valid email address so we can send your receipt.",
      );
      return;
    }

    if (
      !address.name.trim() ||
      !address.line1.trim() ||
      !address.city.trim() ||
      address.state.length !== 2
    ) {
      setAddressError(
        "Complete the full delivery address, including state.",
      );
      return;
    }

    if (!ZIP_PATTERN.test(address.zip)) {
      setAddressError("Enter a 5-digit US ZIP code.");
      return;
    }

    if (!zipMatchesState(address.zip, address.state)) {
      setZipStateError(
        "This ZIP code does not match the state you chose.",
      );
      return;
    }

    if (cartIssueNames.length > 0) {
      setOrderError(
        "Some items in your cart are no longer available. Update your cart to continue.",
      );
      return;
    }

    if (!publishableKey) {
      setOrderError(
        "Payments are not configured. Please contact us to complete your order.",
      );
      return;
    }

    const usableDelivery = deliveryAvailable
      ? delivery
      : await checkDeliveryForZip(address.zip);

    if (!usableDelivery?.available) {
      setAddressError(
        usableDelivery
          ? `We do not deliver to ${address.zip} yet.`
          : deliveryError ||
              "Check delivery for this ZIP before continuing.",
      );
      return;
    }

    if (order) {
      document
        .getElementById("checkout-payment")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setCreatingOrder(true);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
          })),
          zip: address.zip,
          email: email.trim(),
          shipping_address: {
            name: address.name.trim(),
            line1: address.line1.trim(),
            line2: address.line2.trim() || undefined,
            city: address.city.trim(),
            state: address.state,
            zip: address.zip,
          },
          ...(appliedDiscount
            ? { discount_code: appliedDiscount.code }
            : {}),
          sms_opt_in: smsOptIn,
        }),
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          setCustomer(null);
          setContactError(
            "Your session expired. Please sign in again to continue.",
          );
          return;
        }

        if (response.status === 409) {
          const unavailable =
            typeof data === "object" &&
            data !== null &&
            Array.isArray((data as { unavailable?: unknown }).unavailable)
              ? ((data as {
                  unavailable: Array<{ name?: unknown }>;
                }).unavailable
                  .map((entry) =>
                    typeof entry.name === "string" ? entry.name : null,
                  )
                  .filter((name): name is string => Boolean(name)))
              : [];

          setStockIssues(unavailable);
          setOrderError(
            unavailable.length > 0
              ? "Some items no longer have enough stock. Review your cart before paying."
              : "Some items are no longer available. Review your cart before paying.",
          );
          setRetryCount((current) => current + 1);
          return;
        }

        if (response.status === 429) {
          const retryAfter = Number(
            response.headers.get("Retry-After") ?? 0,
          );
          setOrderError(
            `Too many checkout attempts. Try again in ${Math.max(
              1,
              Number.isFinite(retryAfter) ? retryAfter : 60,
            )}s.`,
          );
          return;
        }

        if (response.status === 503) {
          setOrderError(
            "Online payments are temporarily unavailable. Please try again shortly.",
          );
          return;
        }

        const message =
          typeof data === "object" &&
          data !== null &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "We could not create your order. Please try again.";

        setOrderError(message);
        return;
      }

      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as CreatedOrder).order_number !== "string" ||
        typeof (data as CreatedOrder).client_secret !== "string" ||
        typeof (data as CreatedOrder).total_cents !== "number" ||
        typeof (data as CreatedOrder).breakdown !== "object" ||
        (data as CreatedOrder).breakdown === null
      ) {
        setOrderError(
          "We could not start the payment. Please try again.",
        );
        return;
      }

      setOrder(data as CreatedOrder);
      requestAnimationFrame(() => {
        document
          .getElementById("checkout-payment")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setOrderError(
        "We could not reach the checkout service. Check your connection and try again.",
      );
    } finally {
      setCreatingOrder(false);
    }
  }

  async function onSignOut() {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    invalidateOrder();
    const ok = await signOut();

    if (!ok) {
      setContactError("Sign-out failed. Please try again.");
    }

    setSigningOut(false);
  }

  if (items.length === 0) {
    return (
      <section className="zf-checkout">
        <div className="zf-container">
          <p className="zf-checkout__loading" role="status">
            Your cart is empty. Returning to your cart…
          </p>
        </div>
      </section>
    );
  }

  if (!validationError && validatedBody !== itemsBody) {
    return (
      <section className="zf-checkout">
        <div className="zf-container">
          <p className="zf-checkout__loading" role="status">
            Checking your cart…
          </p>
        </div>
      </section>
    );
  }

  if (validationError) {
    return (
      <section className="zf-checkout">
        <div className="zf-container">
          <div className="zf-checkout__blocker" role="alert">
            <h1>We could not check your cart</h1>
            <p>{validationError}</p>
            <div className="zf-checkout__blocker-actions">
              <button
                type="button"
                className="zf-btn zf-btn--primary"
                onClick={() => {
                  setValidatedBody("");
                  setValidationError("");
                  setRetryCount((current) => current + 1);
                }}
              >
                Try again
              </button>
              <Link className="zf-btn zf-btn--ghost" href="/cart">
                Back to cart
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (cartIssueNames.length > 0) {
    return (
      <section className="zf-checkout">
        <div className="zf-container">
          <div className="zf-checkout__blocker" role="alert">
            <h1>Your cart needs attention</h1>
            <p>
              These items are no longer available. Remove or change them in
              your cart before checking out.
            </p>
            <ul className="zf-checkout__blocker-list">
              {cartIssueNames.map((name, index) => (
                <li key={`${index}-${name}`}>{name}</li>
              ))}
            </ul>
            <div className="zf-checkout__blocker-actions">
              <Link className="zf-btn zf-btn--primary" href="/cart">
                Back to cart
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const summarySubtotal = order?.breakdown.subtotal_cents ?? subtotalCents;
  const summaryDiscount =
    order?.breakdown.discount_cents ?? appliedDiscount?.discount_cents ?? 0;
  const summaryDelivery = order
    ? order.breakdown.delivery_fee_cents
    : deliveryAvailable && delivery
      ? delivery.is_free
        ? 0
        : delivery.fee_cents ?? 0
      : null;
  const summaryTax = order ? order.breakdown.tax_cents : null;
  const summaryTotal =
    order?.total_cents ??
    Math.max(
      0,
      summarySubtotal - summaryDiscount + (summaryDelivery ?? 0),
    );

  return (
    <section className="zf-checkout">
      <div className="zf-container">
        <nav className="zf-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <Link href="/cart">Cart</Link>
            </li>
            <li aria-current="page">Checkout</li>
          </ol>
        </nav>

        <div className="zf-checkout__head">
          <p className="zf-eyebrow">Secure checkout</p>
          <h1 className="zf-checkout__title">Checkout</h1>
        </div>

        <div className="zf-checkout__layout">
          <div className="zf-checkout__steps">
            <section
              className="zf-checkout__step"
              aria-labelledby="checkout-contact-title"
            >
              <div className="zf-checkout__step-head">
                <span className="zf-checkout__step-number">1</span>
                <h2 id="checkout-contact-title">Contact</h2>
              </div>

              {customer ? (
                <div className="zf-checkout__signed-in">
                  <p>
                    Signed in as{" "}
                    <strong>{customer.phone_masked}</strong>
                  </p>
                  <button
                    type="button"
                    className="zf-link-button"
                    onClick={() => void onSignOut()}
                    disabled={signingOut}
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : (
                <SignIn
                  heading="Sign in to check out"
                  showSmsOptIn={!smsChoiceMade}
                  smsOptIn={smsOptIn}
                  onSmsOptInChange={(checked) => {
                    setSmsOptIn(checked);
                    setSmsChoiceMade(true);
                  }}
                  onSignedIn={(signedInCustomer) => {
                    setContactError("");
                    if (signedInCustomer.email) {
                      setEmail(
                        (current) => current || signedInCustomer.email || "",
                      );
                    }
                    if (signedInCustomer.name) {
                      setAddress((current) =>
                        current.name
                          ? current
                          : {
                              ...current,
                              name: signedInCustomer.name || "",
                            },
                      );
                    }
                  }}
                />
              )}

              <div className="zf-field">
                <label className="zf-field__label" htmlFor="checkout-email">
                  Email
                </label>
                <input
                  id="checkout-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="zf-input"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setContactError("");
                    invalidateOrder();
                  }}
                />
                <p className="zf-field__help">
                  Your receipt will be sent here.
                </p>
              </div>

              {customer && !smsChoiceMade ? (
                <div className="zf-checkbox">
                  <input
                    id="checkout-sms-opt-in"
                    name="sms_opt_in"
                    type="checkbox"
                    checked={smsOptIn}
                    onChange={(event) => {
                      setSmsOptIn(event.target.checked);
                      setSmsChoiceMade(true);
                    }}
                  />
                  <label htmlFor="checkout-sms-opt-in">
                    Text me occasional offers and updates from Zayn
                    Furnishings. Consent is not a condition of purchase.
                    Message and data rates may apply. Reply STOP to opt out.
                    See our <Link href="/terms">Terms</Link> and{" "}
                    <Link href="/privacy">Privacy Policy</Link>.
                  </label>
                </div>
              ) : null}

              <div className="zf-form__feedback" aria-live="polite">
                {contactError ? (
                  <p className="zf-form__error" role="alert">
                    {contactError}
                  </p>
                ) : null}
              </div>
            </section>

            <section
              className="zf-checkout__step"
              aria-labelledby="checkout-delivery-title"
            >
              <div className="zf-checkout__step-head">
                <span className="zf-checkout__step-number">2</span>
                <h2 id="checkout-delivery-title">Delivery address</h2>
              </div>

              <div className="zf-form-grid">
                <div className="zf-field zf-field--wide">
                  <label className="zf-field__label" htmlFor="checkout-name">
                    Full name
                  </label>
                  <input
                    id="checkout-name"
                    name="name"
                    autoComplete="name"
                    required
                    className="zf-input"
                    value={address.name}
                    onChange={(event) =>
                      updateAddress({ name: event.target.value })
                    }
                  />
                </div>

                <div className="zf-field zf-field--wide">
                  <label className="zf-field__label" htmlFor="checkout-line1">
                    Street address
                  </label>
                  <input
                    id="checkout-line1"
                    name="line1"
                    autoComplete="address-line1"
                    required
                    className="zf-input"
                    value={address.line1}
                    onChange={(event) =>
                      updateAddress({ line1: event.target.value })
                    }
                  />
                </div>

                <div className="zf-field zf-field--wide">
                  <label className="zf-field__label" htmlFor="checkout-line2">
                    Apartment, suite, etc. (optional)
                  </label>
                  <input
                    id="checkout-line2"
                    name="line2"
                    autoComplete="address-line2"
                    className="zf-input"
                    value={address.line2}
                    onChange={(event) =>
                      updateAddress({ line2: event.target.value })
                    }
                  />
                </div>

                <div className="zf-field">
                  <label className="zf-field__label" htmlFor="checkout-city">
                    City
                  </label>
                  <input
                    id="checkout-city"
                    name="city"
                    autoComplete="address-level2"
                    required
                    className="zf-input"
                    value={address.city}
                    onChange={(event) =>
                      updateAddress({ city: event.target.value })
                    }
                  />
                </div>

                <div className="zf-field">
                  <label className="zf-field__label" htmlFor="checkout-state">
                    State
                  </label>
                  <select
                    id="checkout-state"
                    name="state"
                    autoComplete="address-level1"
                    required
                    className="zf-select"
                    value={address.state}
                    onChange={(event) =>
                      updateAddress({ state: event.target.value })
                    }
                  >
                    <option value="">Select a state</option>
                    {US_STATES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="zf-field">
                  <label className="zf-field__label" htmlFor="checkout-zip">
                    ZIP code
                  </label>
                  <input
                    id="checkout-zip"
                    name="zip"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    required
                    className="zf-input"
                    value={address.zip}
                    onChange={(event) =>
                      updateAddress({
                        zip: event.target.value.replace(/\D/g, ""),
                      })
                    }
                    onBlur={() => {
                      if (ZIP_PATTERN.test(address.zip)) {
                        if (
                          address.state &&
                          !zipMatchesState(address.zip, address.state)
                        ) {
                          setZipStateError(
                            "This ZIP code does not match the state you chose.",
                          );
                          return;
                        }

                        setZipStateError("");
                        void checkDeliveryForZip(address.zip);
                      } else if (address.zip) {
                        setDeliveryError(
                          "Enter a 5-digit US ZIP code.",
                        );
                      }
                    }}
                  />
                  {zipStateError ? (
                    <p className="zf-form__error" role="alert">
                      {zipStateError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="zf-checkout__delivery" aria-live="polite">
                {zipChecking ? (
                  <p>Checking delivery to {address.zip}…</p>
                ) : deliveryError ? (
                  <p className="zf-form__error" role="alert">
                    {deliveryError}
                  </p>
                ) : deliveryAvailable && delivery ? (
                  <p>
                    Delivery to {address.zip}:{" "}
                    {delivery.is_free
                      ? "Free"
                      : formatDeliveryFee(delivery.fee_cents ?? 0)}
                    {!delivery.is_free &&
                    delivery.free_over_cents !== null
                      ? ` · Free over ${formatDeliveryFee(
                          delivery.free_over_cents,
                        )}`
                      : ""}
                  </p>
                ) : (
                  <p className="zf-checkout__muted">
                    Enter your ZIP code to calculate delivery.
                  </p>
                )}
              </div>

              <div className="zf-checkout__discount">
                <label className="zf-field__label" htmlFor="checkout-discount">
                  Discount code (optional)
                </label>
                <div className="zf-checkout__discount-row">
                  <input
                    id="checkout-discount"
                    name="discount_code"
                    autoComplete="off"
                    className="zf-input"
                    value={discountInput}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDiscountInput(next);
                      setDiscountError("");
                      invalidateOrder();

                      if (
                        appliedDiscount &&
                        next.trim().toUpperCase() !==
                          appliedDiscount.code.toUpperCase()
                      ) {
                        setAppliedDiscount(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="zf-btn zf-btn--ghost"
                    onClick={() => void applyDiscount()}
                    disabled={applyingDiscount}
                    aria-busy={applyingDiscount}
                  >
                    {applyingDiscount ? "Applying…" : "Apply"}
                  </button>
                </div>
                {appliedDiscount ? (
                  <p className="zf-checkout__discount-applied">
                    <span>
                      {appliedDiscount.code} applied —{" "}
                      {formatCents(appliedDiscount.discount_cents)} off
                    </span>
                    <button
                      type="button"
                      className="zf-link-button"
                      onClick={removeDiscount}
                    >
                      Remove
                    </button>
                  </p>
                ) : null}
                {discountError ? (
                  <p className="zf-form__error" role="alert">
                    {discountError}
                  </p>
                ) : null}
              </div>

              <div className="zf-form__feedback" aria-live="polite">
                {addressError ? (
                  <p className="zf-form__error" role="alert">
                    {addressError}
                  </p>
                ) : null}
              </div>

              {order ? (
                <p className="zf-checkout__order-ready" role="status">
                  Order {order.order_number} is ready. Complete payment below.
                </p>
              ) : (
                <button
                  type="button"
                  className="zf-btn zf-btn--primary zf-checkout__continue"
                  onClick={() => void onContinueToPayment()}
                  disabled={creatingOrder}
                  aria-busy={creatingOrder}
                >
                  {creatingOrder
                    ? "Creating order…"
                    : "Continue to payment"}
                </button>
              )}
            </section>

            <section
              id="checkout-payment"
              className="zf-checkout__step"
              aria-labelledby="checkout-payment-title"
            >
              <div className="zf-checkout__step-head">
                <span className="zf-checkout__step-number">3</span>
                <h2 id="checkout-payment-title">Payment</h2>
              </div>

              {!publishableKey ? (
                <CheckoutPayment
                  order={{
                    order_number: "",
                    client_secret: "",
                    total_cents: summaryTotal,
                    breakdown: {
                      subtotal_cents: summarySubtotal,
                      discount_cents: summaryDiscount,
                      delivery_fee_cents: summaryDelivery ?? 0,
                      tax_cents: 0,
                      total_cents: summaryTotal,
                      discount_code: appliedDiscount?.code ?? null,
                    },
                  }}
                  stripePromise={null}
                />
              ) : order ? (
                <CheckoutPayment order={order} stripePromise={stripePromise} />
              ) : (
                <p className="zf-checkout__muted">
                  Continue to payment to load the secure card form. You will
                  only be charged after you review the total.
                </p>
              )}

              {orderError ? (
                <div className="zf-checkout__order-error" role="alert">
                  <p>{orderError}</p>
                  {stockIssues.length > 0 ? (
                    <ul className="zf-checkout__blocker-list">
                      {stockIssues.map((name, index) => (
                        <li key={`${index}-${name}`}>{name}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="zf-checkout__blocker-actions">
                    {stockIssues.length > 0 ? (
                      <Link
                        className="zf-btn zf-btn--primary"
                        href="/cart"
                      >
                        Back to cart
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="zf-btn zf-btn--ghost"
                        onClick={() => void onContinueToPayment()}
                        disabled={creatingOrder}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <aside
            className="zf-checkout__summary"
            aria-labelledby="checkout-summary-title"
          >
            <button
              type="button"
              className="zf-checkout__summary-toggle"
              aria-expanded={summaryOpen}
              aria-controls="checkout-summary-body"
              onClick={() => setSummaryOpen((open) => !open)}
            >
              <span id="checkout-summary-title">Order summary</span>
              <span>{formatCents(summaryTotal)}</span>
            </button>

            <div
              id="checkout-summary-body"
              className="zf-checkout__summary-body"
              hidden={!summaryOpen}
            >
              <ul className="zf-checkout__summary-items">
                {summaryItems.map((item) => (
                  <li key={item.productId}>
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <span>
                      {item.lineTotalCents === null
                        ? "Checking…"
                        : formatCents(item.lineTotalCents)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="zf-checkout__summary-rows">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatCents(summarySubtotal)}</dd>
                </div>
                <div>
                  <dt>Discount</dt>
                  <dd>
                    {summaryDiscount > 0
                      ? `−${formatCents(summaryDiscount)}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>
                    {summaryDelivery === null
                      ? zipChecking
                        ? "Checking…"
                        : "Enter ZIP code"
                      : summaryDelivery === 0
                        ? "Free"
                        : formatCents(summaryDelivery)}
                  </dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd>
                    {summaryTax === null
                      ? "Calculated at payment"
                      : formatCents(summaryTax)}
                  </dd>
                </div>
              </dl>

              <div className="zf-checkout__summary-total">
                <span>{order ? "Total" : "Estimated total"}</span>
                <strong>{formatCents(summaryTotal)}</strong>
              </div>

              <p className="zf-checkout__summary-note">
                {order
                  ? "Your total is locked in for this payment."
                  : "Tax is calculated when the secure payment starts."}
              </p>

              <Link className="zf-checkout__summary-back" href="/cart">
                Edit cart
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
