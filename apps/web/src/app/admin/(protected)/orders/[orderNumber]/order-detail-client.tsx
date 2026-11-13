"use client";

import { canTransition, isDeliveryOrderBlocked } from "@zayn/shared";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AdminToast,
  useAdminToast,
} from "@/components/admin/admin-toast";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  adminFetch,
  AdminApiError,
  type AdminMe,
  type AdminOrderDetail,
  type AdminOrderStatus,
} from "@/lib/adminApi";
import {
  deliveryStatusLabel,
  describeOrderActivity,
  formatAdminDate,
  formatAdminDateTime,
  orderActivityLabel,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/adminOrderLabels";
import { notifyOrdersChanged } from "@/lib/adminOrderEvents";
import { formatCents } from "@/lib/money";

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

const STATUS_TARGETS: AdminOrderStatus[] = [
  "processing",
  "out_for_delivery",
  "delivered",
];

const FULFILLMENT_FLOW: AdminOrderStatus[] = [
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
];

const DELIVERY_METHOD_OPTIONS = [
  { value: "own_truck", label: "Our own truck" },
  { value: "freight", label: "Freight carrier" },
  { value: "white_glove", label: "White-glove delivery" },
  { value: "pickup", label: "Customer pickup" },
  {
    value: "carrier_parcel",
    label: "Parcel carrier (UPS, FedEx, USPS)",
  },
] as const;

const TIME_WINDOW_OPTIONS = [
  "Morning (8am to 12pm)",
  "Afternoon (12pm to 4pm)",
  "Evening (4pm to 8pm)",
  "All day",
];

type DeliveryFormState = {
  method: string;
  partnerName: string;
  tracking: string;
  scheduledDate: string;
  timeWindow: string;
  driverNotes: string;
};

type DeliveryActionStatus = "out_for_delivery" | "delivered";

function deliveryFormFromOrder(
  order: AdminOrderDetail,
): DeliveryFormState {
  return {
    method: order.delivery?.method ?? "",
    partnerName: order.delivery?.partner_name ?? "",
    tracking: order.delivery?.tracking_number ?? "",
    scheduledDate: order.delivery?.scheduled_date ?? "",
    timeWindow: order.delivery?.time_window ?? "",
    driverNotes: order.delivery?.driver_notes ?? "",
  };
}

function statusActionLabel(
  target: AdminOrderStatus,
  current: AdminOrderStatus,
): string {
  const targetIndex = FULFILLMENT_FLOW.indexOf(target);
  const currentIndex = FULFILLMENT_FLOW.indexOf(current);
  const isBackward =
    targetIndex !== -1 &&
    currentIndex !== -1 &&
    targetIndex < currentIndex;

  if (target === "processing") {
    return isBackward ? "Move back to preparing" : "Mark as preparing";
  }

  if (target === "out_for_delivery") {
    return isBackward
      ? "Move back to out for delivery"
      : "Mark out for delivery";
  }

  if (target === "delivered") {
    return "Mark delivered";
  }

  return orderStatusLabel(target);
}

function confirmDescription(
  order: AdminOrderDetail,
  target: AdminOrderStatus,
): string {
  if (target === "cancelled") {
    return "This stops the payment so the customer will not be charged. If the payment already went through, it will not be cancelled and you will be asked to refresh. This cannot be undone.";
  }

  return `Order ${order.order_number} will move from ${orderStatusLabel(
    order.status,
  )} to ${orderStatusLabel(
    target,
  )}. The customer will see the new status.`;
}

function friendlyApiError(
  error: unknown,
  fallback: string,
  forbiddenMessage: string,
): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) {
      return "Your session has expired. Please sign in again.";
    }

    if (error.status === 403) {
      return forbiddenMessage;
    }

    if (error.status === 404) {
      return "This order could not be found. It may have been removed.";
    }

    if (error.status === 409) {
      return error.message;
    }

    return error.message || fallback;
  }

  return fallback;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function StatusBadge({ status }: { status: AdminOrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${orderStatusBadgeClass(
        status,
      )}`}
    >
      {orderStatusLabel(status)}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-stone-800">{children}</dd>
    </div>
  );
}

export function OrderDetailClient({
  orderNumber,
}: {
  orderNumber: string;
}) {
  const router = useRouter();
  const { toast, showToast, dismissToast } = useAdminToast();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [role, setRole] = useState<AdminMe["role"] | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmTarget, setConfirmTarget] =
    useState<AdminOrderStatus | null>(null);
  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>({
    method: "",
    partnerName: "",
    tracking: "",
    scheduledDate: "",
    timeWindow: "",
    driverNotes: "",
  });
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryConfirmStatus, setDeliveryConfirmStatus] =
    useState<DeliveryActionStatus | null>(null);

  const load = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      const quiet = options.quiet === true;

      if (!quiet) {
        setLoadStatus("loading");
        setError("");
      }

      try {
        const [orderData, me] = await Promise.all([
          adminFetch<AdminOrderDetail>(
            `/admin/orders/${encodeURIComponent(orderNumber)}`,
          ),
          adminFetch<AdminMe>("/admin/me"),
        ]);

        setOrder(orderData);
        setDeliveryForm(deliveryFormFromOrder(orderData));
        setRole(me.role);
        setError("");
        setLoadStatus("ready");
      } catch (loadError) {
        if (!quiet) {
          setError(
            friendlyApiError(
              loadError,
              "Unable to load this order.",
              "You do not have permission to view this order.",
            ),
          );
          setLoadStatus("error");
        }
      }
    },
    [orderNumber],
  );

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

  async function changeStatus(target: AdminOrderStatus) {
    setConfirmTarget(null);
    setSavingStatus(true);

    try {
      await adminFetch(
        `/admin/orders/${encodeURIComponent(orderNumber)}/status`,
        {
          method: "PATCH",
          json: { status: target },
        },
      );

      showToast(
        "success",
        target === "cancelled"
          ? "Order cancelled."
          : `Order marked as ${orderStatusLabel(target).toLowerCase()}.`,
      );
      await load({ quiet: true });
      notifyOrdersChanged();
      router.refresh();
    } catch (changeError) {
      showToast(
        "error",
        friendlyApiError(
          changeError,
          "Unable to update the order.",
          "You do not have permission to make that change.",
        ),
      );

      if (
        changeError instanceof AdminApiError &&
        changeError.status === 409
      ) {
        await load({ quiet: true });
      }
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveDelivery(targetStatus?: DeliveryActionStatus) {
    setDeliveryConfirmStatus(null);
    setDeliveryError("");

    if (!deliveryForm.method) {
      setDeliveryError(
        "Choose a delivery method before saving the delivery.",
      );
      return;
    }

    setSavingDelivery(true);

    try {
      await adminFetch(
        `/admin/orders/${encodeURIComponent(orderNumber)}/delivery`,
        {
          method: "PATCH",
          json: {
            method: deliveryForm.method,
            partner_name: deliveryForm.partnerName.trim() || null,
            tracking: deliveryForm.tracking.trim() || null,
            scheduled_date: deliveryForm.scheduledDate || null,
            time_window: deliveryForm.timeWindow || null,
            driver_notes: deliveryForm.driverNotes.trim() || null,
            status:
              targetStatus ?? order?.delivery?.status ?? "pending",
          },
        },
      );

      showToast(
        "success",
        targetStatus === "out_for_delivery"
          ? "Delivery marked out for delivery."
          : targetStatus === "delivered"
            ? "Delivery marked delivered."
            : "Delivery details saved.",
      );
      await load({ quiet: true });
      notifyOrdersChanged();
      router.refresh();
    } catch (saveError) {
      const message = friendlyApiError(
        saveError,
        "Unable to save the delivery details.",
        "You do not have permission to update the delivery.",
      );

      setDeliveryError(message);
      showToast("error", message);

      if (
        saveError instanceof AdminApiError &&
        saveError.status === 409
      ) {
        await load({ quiet: true });
      }
    } finally {
      setSavingDelivery(false);
      setDeliveryConfirmStatus(null);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = noteText.trim();

    if (!text) {
      return;
    }

    setSavingNote(true);

    try {
      await adminFetch(
        `/admin/orders/${encodeURIComponent(orderNumber)}/notes`,
        {
          method: "POST",
          json: { text },
        },
      );

      setNoteText("");
      showToast("success", "Note added.");
      await load({ quiet: true });
      notifyOrdersChanged();
      router.refresh();
    } catch (noteError) {
      showToast(
        "error",
        friendlyApiError(
          noteError,
          "Unable to add the note.",
          "You do not have permission to add notes.",
        ),
      );
    } finally {
      setSavingNote(false);
    }
  }

  async function copyPaymentId() {
    if (!order?.stripe_payment_intent_id) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        order.stripe_payment_intent_id,
      );
      showToast("success", "Payment ID copied.");
    } catch {
      showToast(
        "error",
        "Could not copy the payment ID. Select it and copy it manually.",
      );
    }
  }

  if (loadStatus === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-6 py-10 text-sm text-stone-600 shadow-sm">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800"
          aria-hidden="true"
        />
        Loading order...
      </div>
    );
  }

  if (loadStatus === "error" || !order) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white px-6 py-10 text-center shadow-sm">
        <p role="alert" className="text-sm text-red-700">
          {error || "Unable to load this order."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Try again
          </button>
          <Link
            href="/admin/orders"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Back to orders
          </Link>
        </div>
      </div>
    );
  }

  const allowedTargets = role
    ? STATUS_TARGETS.filter((target) =>
        canTransition(order.status, target, role),
      )
    : [];
  const canCancel = role
    ? canTransition(order.status, "cancelled", role)
    : false;
  const deliveryBlocked = isDeliveryOrderBlocked(order.status);
  const deliveryAvailable = !deliveryBlocked && order.delivery !== null;
  const deliveryStatus = order.delivery?.status ?? "pending";
  const canMarkOutForDelivery =
    deliveryAvailable &&
    deliveryStatus !== "out_for_delivery" &&
    deliveryStatus !== "delivered";
  const canMarkDelivered =
    deliveryAvailable && deliveryStatus !== "delivered";
  const timeWindowOptions =
    deliveryForm.timeWindow &&
    !TIME_WINDOW_OPTIONS.includes(deliveryForm.timeWindow)
      ? [deliveryForm.timeWindow, ...TIME_WINDOW_OPTIONS]
      : TIME_WINDOW_OPTIONS;

  return (
    <div>
      <AdminToast toast={toast} onDismiss={dismissToast} />

      <Link
        href="/admin/orders"
        className="text-sm font-medium text-stone-600 hover:text-stone-900"
      >
        ← Back to orders
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Order
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {order.order_number}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Placed {formatAdminDate(order.created_at)}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.has_stock_shortage ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
        >
          <p className="font-semibold">
            Not enough stock when this was paid.
          </p>
          <p>Check your inventory and contact the customer.</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Section title="Items">
            {order.items.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                No items on this order.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[520px] w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Line total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item, index) => (
                      <tr
                        key={`${item.sku ?? item.name}-${index}`}
                        className="border-t border-stone-100 align-top"
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-3">
                            {item.image_url ? (
                              <Image
                                src={item.image_url}
                                alt={item.name}
                                width={48}
                                height={48}
                                className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center text-[10px] leading-tight text-stone-400">
                                No photo
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-stone-900">
                                {item.name}
                              </p>
                              <p className="mt-0.5 text-xs text-stone-500">
                                {item.sku ?? "No SKU"}
                              </p>
                              <p className="mt-0.5 text-xs text-stone-500">
                                {formatCents(item.unit_price_cents)} each
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-stone-700">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-stone-900">
                          {formatCents(item.line_total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Internal notes">
            {order.notes ? (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-stone-800">
                {order.notes}
              </p>
            ) : (
              <p className="mt-3 text-sm text-stone-500">
                No internal notes yet.
              </p>
            )}
          </Section>

          <Section title="Add note">
            <form onSubmit={addNote} className="mt-3">
              <label
                htmlFor="order-note"
                className="block text-sm font-medium text-stone-800"
              >
                Note for the team
              </label>
              <textarea
                id="order-note"
                rows={4}
                maxLength={1000}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Add an update, a customer call, or anything the team should know."
                className={`${inputClass} mt-1`}
                disabled={savingNote}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-stone-500">
                  {noteText.length} of 1,000 characters
                </p>
                <button
                  type="submit"
                  disabled={savingNote || !noteText.trim()}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingNote ? "Adding..." : "Add note"}
                </button>
              </div>
            </form>
          </Section>

          <Section title="Activity">
            {order.activity.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                No activity yet.
              </p>
            ) : (
              <ol className="mt-4 space-y-4">
                {order.activity.map((activity, index) => {
                  const summary = describeOrderActivity(activity);

                  return (
                    <li
                      key={`${activity.created_at}-${activity.action}-${index}`}
                      className="border-l-2 border-stone-200 pl-4"
                    >
                      <p className="text-sm font-medium text-stone-900">
                        {orderActivityLabel(activity.action)}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {formatAdminDateTime(activity.created_at)}
                        {" · "}
                        {activity.admin_email ?? "System"}
                      </p>
                      {summary ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-stone-700">
                          {summary}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Status">
            <div className="mt-3">
              <StatusBadge status={order.status} />
            </div>

            {role === null ? (
              <p className="mt-4 text-sm leading-6 text-stone-600">
                Your role could not be loaded, so status changes are
                unavailable. Refresh the page to try again.
              </p>
            ) : null}

            {role !== null &&
            allowedTargets.length === 0 &&
            !canCancel ? (
              <p className="mt-4 text-sm leading-6 text-stone-600">
                No status changes are available for this order.
              </p>
            ) : null}

            {allowedTargets.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {allowedTargets.map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => setConfirmTarget(target)}
                    disabled={savingStatus}
                    className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {statusActionLabel(target, order.status)}
                  </button>
                ))}
              </div>
            ) : null}

            {canCancel ? (
              <button
                type="button"
                onClick={() => setConfirmTarget("cancelled")}
                disabled={savingStatus}
                className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel this order
              </button>
            ) : null}

            {order.status === "paid" ? (
              <p className="mt-4 text-sm leading-6 text-stone-600">
                To cancel a paid order you will need to refund it (coming
                soon).
              </p>
            ) : null}
          </Section>

          <Section title="Money summary">
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-stone-600">Subtotal</dt>
                <dd className="font-medium text-stone-900">
                  {formatCents(order.subtotal_cents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-stone-600">
                  Discount
                  {order.discount_code ? ` (${order.discount_code})` : ""}
                </dt>
                <dd className="font-medium text-stone-900">
                  {order.discount_cents > 0
                    ? `-${formatCents(order.discount_cents)}`
                    : formatCents(0)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-stone-600">Delivery</dt>
                <dd className="font-medium text-stone-900">
                  {formatCents(order.delivery_fee_cents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-stone-600">Tax</dt>
                <dd className="font-medium text-stone-900">
                  {formatCents(order.tax_cents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-2">
                <dt className="font-semibold text-stone-900">Total</dt>
                <dd className="text-base font-semibold text-stone-900">
                  {formatCents(order.total_cents)}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Customer">
            <dl className="mt-4 space-y-3">
              <Field label="Name">
                {order.customer.name ?? "Guest"}
              </Field>
              <Field label="Phone">
                {order.customer.phone ? (
                  <a
                    href={telHref(order.customer.phone)}
                    className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900"
                  >
                    {order.customer.phone}
                  </a>
                ) : (
                  "No phone"
                )}
              </Field>
              <Field label="Email">
                <a
                  href={`mailto:${order.customer.receipt_email}`}
                  className="break-all font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900"
                >
                  {order.customer.receipt_email}
                </a>
              </Field>
              <Field label="SMS updates">
                {order.customer.sms_opt_in ? "On" : "Off"}
              </Field>
            </dl>
          </Section>

          <Section title="Delivery address">
            {order.shipping_address.line1 ? (
              <address className="mt-4 space-y-0.5 text-sm not-italic leading-6 text-stone-800">
                <p className="font-medium">
                  {order.shipping_address.name ?? "No name"}
                </p>
                <p>{order.shipping_address.line1}</p>
                {order.shipping_address.line2 ? (
                  <p>{order.shipping_address.line2}</p>
                ) : null}
                <p>
                  {[
                    order.shipping_address.city,
                    order.shipping_address.state,
                    order.shipping_address.zip,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {order.shipping_address.phone ? (
                  <p className="pt-1 text-stone-600">
                    {order.shipping_address.phone}
                  </p>
                ) : null}
              </address>
            ) : (
              <p className="mt-3 text-sm text-stone-500">
                No delivery address on file.
              </p>
            )}
          </Section>

          <Section title="Payment">
            {order.payments.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                No payments recorded yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {order.payments.map((payment, index) => (
                  <li
                    key={`${payment.created_at}-${index}`}
                    className="rounded-lg border border-stone-200 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-stone-900">
                        {payment.provider === "stripe"
                          ? "Stripe"
                          : payment.provider}
                      </p>
                      <p className="text-sm font-medium text-stone-900">
                        {formatCents(payment.amount_cents)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {paymentStatusLabel(payment.status)}
                      {" · "}
                      {formatAdminDateTime(payment.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 border-t border-stone-200 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Stripe payment ID
              </p>
              {order.stripe_payment_intent_id ? (
                <div className="mt-1 flex flex-wrap items-start gap-2">
                  <code className="min-w-0 break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-800">
                    {order.stripe_payment_intent_id}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyPaymentId()}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-stone-500">
                  No payment has been started.
                </p>
              )}
            </div>
          </Section>

          <Section title="Delivery">
            {!deliveryAvailable ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                {deliveryBlocked
                  ? "Delivery can be managed after payment."
                  : "Delivery details are not available yet. Refresh the order and try again."}
              </p>
            ) : (
              <p className="mt-3 text-sm text-stone-500">
                Current delivery status:{" "}
                {deliveryStatusLabel(deliveryStatus)}
              </p>
            )}

            <fieldset
              disabled={!deliveryAvailable || savingDelivery}
              className="mt-4 space-y-4 disabled:opacity-60"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="delivery-method"
                    className="block text-sm font-medium text-stone-800"
                  >
                    Delivery method
                  </label>
                  <select
                    id="delivery-method"
                    value={deliveryForm.method}
                    onChange={(event) =>
                      setDeliveryForm((current) => ({
                        ...current,
                        method: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">Choose a method</option>
                    {DELIVERY_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="delivery-partner"
                    className="block text-sm font-medium text-stone-800"
                  >
                    Delivery company
                  </label>
                  <input
                    id="delivery-partner"
                    type="text"
                    maxLength={120}
                    value={deliveryForm.partnerName}
                    onChange={(event) =>
                      setDeliveryForm((current) => ({
                        ...current,
                        partnerName: event.target.value,
                      }))
                    }
                    placeholder="e.g. UPS, FedEx, or a local partner"
                    className={`${inputClass} mt-1`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="delivery-tracking"
                    className="block text-sm font-medium text-stone-800"
                  >
                    Tracking number
                  </label>
                  <input
                    id="delivery-tracking"
                    type="text"
                    maxLength={120}
                    value={deliveryForm.tracking}
                    onChange={(event) =>
                      setDeliveryForm((current) => ({
                        ...current,
                        tracking: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="delivery-date"
                    className="block text-sm font-medium text-stone-800"
                  >
                    Delivery date
                  </label>
                  <input
                    id="delivery-date"
                    type="date"
                    value={deliveryForm.scheduledDate}
                    onChange={(event) =>
                      setDeliveryForm((current) => ({
                        ...current,
                        scheduledDate: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="delivery-time-window"
                    className="block text-sm font-medium text-stone-800"
                  >
                    Time window
                  </label>
                  <select
                    id="delivery-time-window"
                    value={deliveryForm.timeWindow}
                    onChange={(event) =>
                      setDeliveryForm((current) => ({
                        ...current,
                        timeWindow: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">Not set</option>
                    {timeWindowOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="delivery-driver-notes"
                  className="block text-sm font-medium text-stone-800"
                >
                  Driver notes
                </label>
                <p className="mt-0.5 text-xs leading-5 text-stone-500">
                  Private notes for the delivery team. Customers do not see
                  this.
                </p>
                <textarea
                  id="delivery-driver-notes"
                  rows={3}
                  maxLength={1000}
                  value={deliveryForm.driverNotes}
                  onChange={(event) =>
                    setDeliveryForm((current) => ({
                      ...current,
                      driverNotes: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </div>

              {deliveryError ? (
                <p role="alert" className="text-sm text-red-700">
                  {deliveryError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveDelivery()}
                  disabled={savingDelivery || !deliveryForm.method}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDelivery ? "Saving..." : "Save delivery"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeliveryConfirmStatus("out_for_delivery")
                  }
                  disabled={
                    savingDelivery ||
                    !deliveryForm.method ||
                    !canMarkOutForDelivery
                  }
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark out for delivery
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryConfirmStatus("delivered")}
                  disabled={
                    savingDelivery ||
                    !deliveryForm.method ||
                    !canMarkDelivered
                  }
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark delivered
                </button>
              </div>

              {deliveryAvailable && !deliveryForm.method ? (
                <p className="text-xs text-stone-500">
                  Choose a delivery method before saving or updating the
                  delivery.
                </p>
              ) : null}
            </fieldset>
          </Section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget === "cancelled"
            ? "Cancel this order?"
            : confirmTarget
              ? `${statusActionLabel(confirmTarget, order.status)}?`
              : "Confirm change"
        }
        description={
          confirmTarget
            ? confirmDescription(order, confirmTarget)
            : ""
        }
        confirmLabel={
          confirmTarget === "cancelled"
            ? "Cancel order"
            : confirmTarget
              ? statusActionLabel(confirmTarget, order.status)
              : "Confirm"
        }
        busy={savingStatus}
        onCancel={() => {
          if (!savingStatus) {
            setConfirmTarget(null);
          }
        }}
        onConfirm={() => {
          if (confirmTarget) {
            void changeStatus(confirmTarget);
          }
        }}
      />

      <ConfirmDialog
        open={deliveryConfirmStatus !== null}
        title={
          deliveryConfirmStatus === "delivered"
            ? "Mark delivered?"
            : "Mark out for delivery?"
        }
        description={
          deliveryConfirmStatus === "delivered"
            ? "This saves the delivery details and marks the delivery delivered. It also updates the order status when possible."
            : "This saves the delivery details and marks the delivery out for delivery. It also updates the order status when possible."
        }
        confirmLabel={
          deliveryConfirmStatus === "delivered"
            ? "Mark delivered"
            : "Mark out for delivery"
        }
        busy={savingDelivery}
        onCancel={() => {
          if (!savingDelivery) {
            setDeliveryConfirmStatus(null);
          }
        }}
        onConfirm={() => {
          if (deliveryConfirmStatus) {
            void saveDelivery(deliveryConfirmStatus);
          }
        }}
      />
    </div>
  );
}
