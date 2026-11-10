import type { PublicDeliveryCheck } from "@zayn/shared";
import { formatCents } from "@/lib/money";

const ZIP_COOKIE = "zf-zip";

export type DeliveryResult = PublicDeliveryCheck;

export type DeliveryOutcome = {
  result: DeliveryResult | null;
  error: string;
};

function isDeliveryResult(value: unknown): value is DeliveryResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.available === "boolean" &&
    typeof candidate.subtotal_cents === "number" &&
    (candidate.fee_cents === null ||
      typeof candidate.fee_cents === "number") &&
    typeof candidate.is_free === "boolean" &&
    (candidate.free_over_cents === null ||
      typeof candidate.free_over_cents === "number") &&
    (candidate.amount_to_free_cents === null ||
      typeof candidate.amount_to_free_cents === "number") &&
    (candidate.zone === null || typeof candidate.zone === "object")
  );
}

export function readZipCookie(): string | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${ZIP_COOKIE}=`));

    return match ? match.split("=")[1] : null;
  } catch {
    return null;
  }
}

export function subscribeZipCookie(callback: () => void) {
  window.addEventListener("focus", callback);

  return () => window.removeEventListener("focus", callback);
}

export function getZipSnapshot(): string | null {
  return readZipCookie();
}

export function getZipServerSnapshot(): string | null {
  return null;
}

export function formatDeliveryFee(cents: number): string {
  return formatCents(cents).replace(/\.00$/, "");
}

export async function requestDelivery(
  zip: string,
  subtotalCents?: number,
): Promise<DeliveryOutcome> {
  try {
    const response = await fetch("/api/zip-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zip,
        ...(subtotalCents !== undefined
          ? { subtotal_cents: subtotalCents }
          : {}),
      }),
    });

    if (!response.ok) {
      return {
        result: null,
        error:
          response.status === 400
            ? "Enter a 5-digit US ZIP code."
            : "We couldn't check that ZIP. Please try again.",
      };
    }

    const data: unknown = await response.json().catch(() => null);

    if (!isDeliveryResult(data)) {
      return {
        result: null,
        error: "We couldn't check that ZIP. Please try again.",
      };
    }

    return { result: data, error: "" };
  } catch {
    return {
      result: null,
      error: "We couldn't check that ZIP. Please try again.",
    };
  }
}
