import { createHmac, timingSafeEqual } from "node:crypto";
import type { BulkPriceChangeRow } from "@zayn/shared";
import type { PriceChangeParamsInput } from "./priceChanges";

export const PRICE_CHANGE_PREVIEW_TTL_MS = 15 * 60 * 1000;

const TOKEN_VERSION = "v1";

function normalizedValue(params: PriceChangeParamsInput): number {
  if (
    params.mode === "percent_increase" ||
    params.mode === "percent_decrease"
  ) {
    return Math.round(params.value * 100);
  }

  return Math.round(params.value);
}

function scopePart(params: PriceChangeParamsInput): string {
  if (params.scope.type === "all") {
    return "all";
  }

  return `category:${params.scope.category_id}:${
    params.scope.include_children ? "1" : "0"
  }`;
}

export function canonicalPriceChangeParams(
  params: PriceChangeParamsInput,
): string {
  const statuses = [...params.statuses].sort().join(",");

  return [
    scopePart(params),
    statuses,
    params.mode,
    String(normalizedValue(params)),
    params.apply_to,
    params.rounding,
  ].join("|");
}

export function canonicalPriceChangeRows(
  rows: BulkPriceChangeRow[],
): string {
  return [...rows]
    .sort((left, right) => left.productId.localeCompare(right.productId))
    .map(
      (row) => `${row.productId}:${row.oldPrice}:${row.oldSale ?? ""}`,
    )
    .join(",");
}

function signatureFor(
  secret: string,
  expiresAt: number,
  params: PriceChangeParamsInput,
  rows: BulkPriceChangeRow[],
): string {
  return createHmac("sha256", secret)
    .update(
      `${TOKEN_VERSION}\n${expiresAt}\n${canonicalPriceChangeParams(
        params,
      )}\n${canonicalPriceChangeRows(rows)}`,
    )
    .digest("hex");
}

export function signPriceChangePreview(input: {
  params: PriceChangeParamsInput;
  okRows: BulkPriceChangeRow[];
  secret: string;
  now?: Date;
  ttlMs?: number;
}): string {
  const now = input.now ?? new Date();
  const expiresAt =
    now.getTime() + (input.ttlMs ?? PRICE_CHANGE_PREVIEW_TTL_MS);
  const signature = signatureFor(
    input.secret,
    expiresAt,
    input.params,
    input.okRows,
  );

  return `${TOKEN_VERSION}.${expiresAt}.${signature}`;
}

export function verifyPriceChangePreview(input: {
  token: string;
  params: PriceChangeParamsInput;
  okRows: BulkPriceChangeRow[];
  secret: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: "invalid" | "expired" } {
  const parts = input.token.split(".");

  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: "invalid" };
  }

  const expiresAt = Number(parts[1]);

  if (!Number.isFinite(expiresAt)) {
    return { ok: false, reason: "invalid" };
  }

  if (expiresAt < (input.now ?? new Date()).getTime()) {
    return { ok: false, reason: "expired" };
  }

  const expected = signatureFor(
    input.secret,
    expiresAt,
    input.params,
    input.okRows,
  );
  const actualBuffer = Buffer.from(parts[2], "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return { ok: false, reason: "invalid" };
  }

  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true };
}
