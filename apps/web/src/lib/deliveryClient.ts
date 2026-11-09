import { formatCents } from "@/lib/money";

const ZIP_COOKIE = "zf-zip";

export type DeliveryResult = {
  available: boolean;
  fee_cents: number | null;
  free_over_cents: number | null;
};

export type DeliveryOutcome = {
  result: DeliveryResult | null;
  error: string;
};

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

export async function requestDelivery(zip: string): Promise<DeliveryOutcome> {
  try {
    const response = await fetch("/api/zip-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip }),
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

    if (typeof data !== "object" || data === null) {
      return {
        result: null,
        error: "We couldn't check that ZIP. Please try again.",
      };
    }

    const record = data as {
      available?: unknown;
      fee_cents?: unknown;
      free_over_cents?: unknown;
    };

    return {
      result: {
        available: record.available === true,
        fee_cents:
          typeof record.fee_cents === "number" ? record.fee_cents : null,
        free_over_cents:
          typeof record.free_over_cents === "number"
            ? record.free_over_cents
            : null,
      },
      error: "",
    };
  } catch {
    return {
      result: null,
      error: "We couldn't check that ZIP. Please try again.",
    };
  }
}
