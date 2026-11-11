export type DiscountKind = "percent" | "fixed";

export interface DiscountValue {
  type: DiscountKind;
  value: number;
}

export interface DiscountRule extends DiscountValue {
  minOrderCents: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

export type DiscountIneligibilityReason =
  | "inactive"
  | "not_started"
  | "expired"
  | "min_order"
  | "usage_limit"
  | "invalid_value";

export type DiscountEvaluation =
  | { eligible: true; discountCents: number }
  | { eligible: false; reason: DiscountIneligibilityReason };

export interface OrderTotalsInput {
  subtotalCents: number;
  discountCents?: number | null;
  deliveryFeeCents?: number | null;
  taxCents?: number | null;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface TaxAddress {
  state?: string | null;
  zip?: string | null;
}

export interface StockDeduction {
  requestedQty: number;
  availableQty: number;
  appliedQty: number;
  shortfallQty: number;
  remainingQty: number;
}

function toInteger(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function nonNegativeInteger(value: number | null | undefined): number {
  return Math.max(0, toInteger(value ?? 0));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateMilliseconds(value: Date | string | null): number | null {
  if (value === null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Discount in integer cents, capped to the subtotal so a code can never
 * make an order negative. Percent values are capped at 100%.
 */
export function calculateDiscountCents(
  subtotalCents: number,
  discount: DiscountValue | null | undefined,
): number {
  const subtotal = nonNegativeInteger(subtotalCents);

  if (!discount) {
    return 0;
  }

  const value = Number.isFinite(discount.value) ? discount.value : 0;

  if (discount.type === "percent") {
    const percent = clampInteger(value, 0, 100);
    return clampInteger(
      Math.round((subtotal * percent) / 100),
      0,
      subtotal,
    );
  }

  return clampInteger(toInteger(value), 0, subtotal);
}

export function evaluateDiscountCode(
  code: DiscountRule | null | undefined,
  subtotalCents: number,
  now: Date = new Date(),
): DiscountEvaluation {
  const subtotal = nonNegativeInteger(subtotalCents);

  if (!code || !code.isActive) {
    return { eligible: false, reason: "inactive" };
  }

  if (!Number.isFinite(code.value) || code.value <= 0) {
    return { eligible: false, reason: "invalid_value" };
  }

  const nowMilliseconds = now.getTime();
  const startsAt = dateMilliseconds(code.startsAt);

  if (startsAt !== null && startsAt > nowMilliseconds) {
    return { eligible: false, reason: "not_started" };
  }

  const endsAt = dateMilliseconds(code.endsAt);

  if (endsAt !== null && endsAt < nowMilliseconds) {
    return { eligible: false, reason: "expired" };
  }

  if (subtotal < nonNegativeInteger(code.minOrderCents)) {
    return { eligible: false, reason: "min_order" };
  }

  if (code.usageLimit !== null && code.usedCount >= code.usageLimit) {
    return { eligible: false, reason: "usage_limit" };
  }

  return {
    eligible: true,
    discountCents: calculateDiscountCents(subtotal, code),
  };
}

/**
 * Tax is always zero until Stripe Tax is wired up. Kept as a separate
 * function so orders already carry a tax line and callers do not change.
 *
 * TODO: Replace this with Stripe Tax (or another tax provider) once the
 * store is registered for tax collection.
 */
export function calculateTaxCents(
  _subtotalCents: number,
  _address: TaxAddress,
): number {
  return 0;
}

export function calculateOrderTotals(
  input: OrderTotalsInput,
): OrderTotals {
  const subtotalCents = nonNegativeInteger(input.subtotalCents);
  const discountCents = clampInteger(
    nonNegativeInteger(input.discountCents),
    0,
    subtotalCents,
  );
  const deliveryFeeCents = nonNegativeInteger(input.deliveryFeeCents);
  const taxCents = nonNegativeInteger(input.taxCents);

  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    taxCents,
    totalCents:
      subtotalCents - discountCents + deliveryFeeCents + taxCents,
  };
}

/**
 * Clamps a stock deduction so stock can never go negative. The shortfall is
 * the quantity that could not be fulfilled and should be recorded for
 * manual review.
 */
export function calculateStockDeduction(
  requestedQty: number,
  availableQty: number,
): StockDeduction {
  const requested = nonNegativeInteger(requestedQty);
  const available = nonNegativeInteger(availableQty);
  const appliedQty = Math.min(requested, available);

  return {
    requestedQty: requested,
    availableQty: available,
    appliedQty,
    shortfallQty: requested - appliedQty,
    remainingQty: available - appliedQty,
  };
}
