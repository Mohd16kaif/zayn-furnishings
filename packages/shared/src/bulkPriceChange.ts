export type BulkPriceProductStatus = "active" | "draft" | "archived";

export type BulkPriceChangeMode =
  | "percent_increase"
  | "percent_decrease"
  | "amount_increase"
  | "amount_decrease";

export type BulkPriceChangeApplyTo = "regular" | "sale" | "both";

export type BulkPriceChangeRounding =
  | "none"
  | "nearest_dollar"
  | "end_99"
  | "end_00_up";

export type BulkPriceChangeRowStatus = "ok" | "unchanged" | "blocked";

export const BULK_PRICE_MIN_CENTS = 100;
export const BULK_PRICE_MAX_CENTS = 100_000_000;
export const BULK_PRICE_PERCENT_MIN = 0.01;
export const BULK_PRICE_PERCENT_MAX = 90;
export const BULK_PRICE_MAX_PRODUCTS = 500;

export type BulkPriceChangeScope =
  | { type: "all" }
  | {
      type: "category";
      categoryId: string;
      includeChildren: boolean;
      categoryIds?: string[];
      categoryName?: string | null;
    };

export interface BulkPriceChangeParams {
  scope: BulkPriceChangeScope;
  productStatus: BulkPriceProductStatus[];
  mode: BulkPriceChangeMode;
  value: number;
  applyTo: BulkPriceChangeApplyTo;
  rounding: BulkPriceChangeRounding;
}

export interface BulkPriceProduct {
  id: string;
  name: string;
  priceCents: number;
  salePriceCents: number | null;
  status: BulkPriceProductStatus;
  categoryId: string | null;
}

export interface BulkPriceChangeRow {
  productId: string;
  name: string;
  categoryId: string | null;
  productStatus: BulkPriceProductStatus;
  oldPrice: number;
  oldSale: number | null;
  newPrice: number;
  newSale: number | null;
  status: BulkPriceChangeRowStatus;
  reason: string | null;
}

export interface BulkPriceChangeCounts {
  ok: number;
  unchanged: number;
  blocked: number;
}

export interface BulkPriceChangeTotals {
  okCount: number;
  oldRegularCents: number;
  newRegularCents: number;
  regularDifferenceCents: number;
  oldSaleCents: number;
  newSaleCents: number;
  saleDifferenceCents: number;
}

export interface BulkPriceChangeResult {
  rows: BulkPriceChangeRow[];
  counts: BulkPriceChangeCounts;
  totals: BulkPriceChangeTotals;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function percentBasisPoints(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(1, Math.round(finite * 100));
}

function amountCents(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return clampInteger(finite, 1, BULK_PRICE_MAX_CENTS);
}

function roundedHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function applyPercent(cents: number, basisPoints: number): number {
  return roundedHalfUp(cents * basisPoints, 10_000);
}

function nearestDollar(cents: number): number {
  return roundedHalfUp(cents, 100) * 100;
}

function endIn99(cents: number): number {
  const wholeDollars = Math.floor(cents / 100);
  const candidate = wholeDollars * 100 + 99;

  return cents <= candidate ? candidate : (wholeDollars + 1) * 100 + 99;
}

function endIn00Up(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}

function roundPrice(cents: number, rounding: BulkPriceChangeRounding): number {
  if (rounding === "nearest_dollar") {
    return nearestDollar(cents);
  }

  if (rounding === "end_99") {
    return endIn99(cents);
  }

  if (rounding === "end_00_up") {
    return endIn00Up(cents);
  }

  return cents;
}

function nextPrice(
  cents: number,
  params: BulkPriceChangeParams,
): number {
  if (params.mode === "percent_increase") {
    return cents + applyPercent(cents, percentBasisPoints(params.value));
  }

  if (params.mode === "percent_decrease") {
    return cents - applyPercent(cents, percentBasisPoints(params.value));
  }

  if (params.mode === "amount_increase") {
    return cents + amountCents(params.value);
  }

  return cents - amountCents(params.value);
}

function formatCents(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const remainder = String(Math.abs(cents) % 100).padStart(2, "0");
  const sign = cents < 0 ? "-" : "";

  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

function blocked(
  product: BulkPriceProduct,
  newPrice: number,
  newSale: number | null,
  reason: string,
): BulkPriceChangeRow {
  return {
    productId: product.id,
    name: product.name,
    categoryId: product.categoryId,
    productStatus: product.status,
    oldPrice: product.priceCents,
    oldSale: product.salePriceCents,
    newPrice,
    newSale,
    status: "blocked",
    reason,
  };
}

function unchanged(
  product: BulkPriceProduct,
  newPrice: number,
  newSale: number | null,
  reason: string,
): BulkPriceChangeRow {
  return {
    productId: product.id,
    name: product.name,
    categoryId: product.categoryId,
    productStatus: product.status,
    oldPrice: product.priceCents,
    oldSale: product.salePriceCents,
    newPrice,
    newSale,
    status: "unchanged",
    reason,
  };
}

function computeRow(
  product: BulkPriceProduct,
  params: BulkPriceChangeParams,
): BulkPriceChangeRow {
  const changeRegular =
    params.applyTo === "regular" || params.applyTo === "both";
  const changeSale = params.applyTo === "sale" || params.applyTo === "both";

  if (changeSale && product.salePriceCents === null) {
    return unchanged(
      product,
      product.priceCents,
      null,
      "This product has no sale price, so it was skipped.",
    );
  }

  const rawPrice = changeRegular
    ? nextPrice(product.priceCents, params)
    : product.priceCents;
  const rawSale = changeSale
    ? nextPrice(product.salePriceCents as number, params)
    : product.salePriceCents;
  const newPrice = roundPrice(rawPrice, params.rounding);
  const newSale =
    rawSale === null ? null : roundPrice(rawSale, params.rounding);

  if (changeRegular) {
    if (newPrice < BULK_PRICE_MIN_CENTS) {
      return blocked(
        product,
        newPrice,
        newSale,
        `The new regular price would be below ${formatCents(BULK_PRICE_MIN_CENTS)}.`,
      );
    }

    if (newPrice > BULK_PRICE_MAX_CENTS) {
      return blocked(
        product,
        newPrice,
        newSale,
        `The new regular price would be above ${formatCents(BULK_PRICE_MAX_CENTS)}.`,
      );
    }
  }

  if (changeSale) {
    if (newSale === null) {
      return unchanged(
        product,
        product.priceCents,
        null,
        "This product has no sale price, so it was skipped.",
      );
    }

    if (newSale < BULK_PRICE_MIN_CENTS) {
      return blocked(
        product,
        newPrice,
        newSale,
        `The new sale price would be below ${formatCents(BULK_PRICE_MIN_CENTS)}.`,
      );
    }

    if (newSale > BULK_PRICE_MAX_CENTS) {
      return blocked(
        product,
        newPrice,
        newSale,
        `The new sale price would be above ${formatCents(BULK_PRICE_MAX_CENTS)}.`,
      );
    }
  }

  if (newSale !== null && newSale >= newPrice) {
    if (changeSale) {
      return blocked(
        product,
        newPrice,
        newSale,
        `The new sale price must stay below the regular price of ${formatCents(newPrice)}.`,
      );
    }

    return blocked(
      product,
      newPrice,
      newSale,
      `The existing sale price of ${formatCents(newSale)} would no longer be below the new regular price of ${formatCents(newPrice)}. Change the sale price too, or use a smaller increase.`,
    );
  }

  if (newPrice === product.priceCents && newSale === product.salePriceCents) {
    return unchanged(
      product,
      newPrice,
      newSale,
      "The price would not change.",
    );
  }

  return {
    productId: product.id,
    name: product.name,
    categoryId: product.categoryId,
    productStatus: product.status,
    oldPrice: product.priceCents,
    oldSale: product.salePriceCents,
    newPrice,
    newSale,
    status: "ok",
    reason: null,
  };
}

function inScope(
  product: BulkPriceProduct,
  scope: BulkPriceChangeScope,
): boolean {
  if (scope.type === "all") {
    return true;
  }

  if (scope.categoryIds && scope.categoryIds.length > 0) {
    return product.categoryId !== null && scope.categoryIds.includes(product.categoryId);
  }

  return product.categoryId === scope.categoryId;
}

export function computeBulkPriceChange(
  products: BulkPriceProduct[],
  params: BulkPriceChangeParams,
): BulkPriceChangeResult {
  const statuses = new Set(params.productStatus);
  const counts: BulkPriceChangeCounts = { ok: 0, unchanged: 0, blocked: 0 };
  const totals: BulkPriceChangeTotals = {
    okCount: 0,
    oldRegularCents: 0,
    newRegularCents: 0,
    regularDifferenceCents: 0,
    oldSaleCents: 0,
    newSaleCents: 0,
    saleDifferenceCents: 0,
  };
  const rows: BulkPriceChangeRow[] = [];

  for (const product of products) {
    if (!statuses.has(product.status) || !inScope(product, params.scope)) {
      continue;
    }

    const row = computeRow(product, params);
    rows.push(row);
    counts[row.status] += 1;

    if (row.status === "ok") {
      totals.okCount += 1;
      totals.oldRegularCents += row.oldPrice;
      totals.newRegularCents += row.newPrice;
      totals.regularDifferenceCents += row.newPrice - row.oldPrice;
      totals.oldSaleCents += row.oldSale ?? 0;
      totals.newSaleCents += row.newSale ?? 0;
      totals.saleDifferenceCents += (row.newSale ?? 0) - (row.oldSale ?? 0);
    }
  }

  return { rows, counts, totals };
}

function statusWords(statuses: BulkPriceProductStatus[]): string {
  const set = new Set(statuses);

  if (
    set.size === 3 &&
    set.has("active") &&
    set.has("draft") &&
    set.has("archived")
  ) {
    return "All products, including archived";
  }

  if (set.size === 2 && set.has("active") && set.has("draft")) {
    return "Active and draft products";
  }

  if (set.size === 1 && set.has("active")) {
    return "Active products";
  }

  if (set.size === 1 && set.has("draft")) {
    return "Draft products";
  }

  if (set.size === 1 && set.has("archived")) {
    return "Archived products";
  }

  return "Selected products";
}

function modeWords(params: BulkPriceChangeParams): string {
  const isPercent =
    params.mode === "percent_increase" ||
    params.mode === "percent_decrease";
  const isIncrease =
    params.mode === "percent_increase" ||
    params.mode === "amount_increase";
  const amount = isPercent
    ? `${Number(params.value.toFixed(2))}%`
    : formatCents(Math.round(params.value));

  return `${amount} ${isIncrease ? "increase" : "decrease"}`;
}

function applyWords(applyTo: BulkPriceChangeApplyTo): string {
  if (applyTo === "sale") {
    return "sale prices";
  }

  if (applyTo === "both") {
    return "regular and sale prices";
  }

  return "regular prices";
}

function roundingWords(rounding: BulkPriceChangeRounding): string {
  if (rounding === "nearest_dollar") {
    return "rounded to the nearest dollar";
  }

  if (rounding === "end_99") {
    return "rounded up to end in 99 cents";
  }

  if (rounding === "end_00_up") {
    return "rounded up to the next whole dollar";
  }

  return "not rounded";
}

export function describeBulkPriceChange(
  params: BulkPriceChangeParams,
): string {
  const place =
    params.scope.type === "all"
      ? "All products"
      : `Products in ${params.scope.categoryName ?? "the selected category"}${
          params.scope.includeChildren ? " (including subcategories)" : ""
        }`;

  return `${place}: ${modeWords(params)} on ${applyWords(params.applyTo)}, ${roundingWords(params.rounding)}. ${statusWords(params.productStatus)}.`;
}
