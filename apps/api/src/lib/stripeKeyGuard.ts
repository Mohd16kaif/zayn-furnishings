import type { AppEnv } from "@zayn/shared";

export type StripeKeyKind = "missing" | "live" | "test" | "unknown";

export function stripeKeyKind(key: string | null | undefined): StripeKeyKind {
  if (typeof key !== "string" || key.trim() === "") {
    return "missing";
  }

  const value = key.trim();

  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) {
    return "live";
  }

  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) {
    return "test";
  }

  return "unknown";
}

export function liveStripeKeyOutsideProductionError(
  appEnv: AppEnv,
  key: string | null | undefined,
): string | null {
  if (appEnv === "production") {
    return null;
  }

  if (stripeKeyKind(key) !== "live") {
    return null;
  }

  return `Refusing to start: STRIPE_SECRET_KEY is a live Stripe key but APP_ENV is "${appEnv}". Use a test key outside production.`;
}

export function testStripeKeyInProductionWarning(
  appEnv: AppEnv,
  key: string | null | undefined,
): string | null {
  if (appEnv !== "production") {
    return null;
  }

  if (stripeKeyKind(key) !== "test") {
    return null;
  }

  return "WARNING: APP_ENV=production but STRIPE_SECRET_KEY is a TEST key. Real payments will NOT be charged. Replace it with a live key before accepting orders.";
}
