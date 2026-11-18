import { defaultStoreOpen } from "@zayn/shared";
import { APP_ENV } from "./appEnv";

const API_TIMEOUT_MS = 2_500;
const STATUS_CACHE_MS = 5_000;

let cachedStatus: { storeOpen: boolean; expiresAt: number } | null = null;

export async function readStoreOpen(): Promise<boolean> {
  const now = Date.now();

  if (cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.storeOpen;
  }

  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const key = process.env.STOREFRONT_API_KEY;

  try {
    const response = await fetch(`${base}/api/public/settings`, {
      headers: key ? { "x-storefront-key": key } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return defaultStoreOpen(APP_ENV);
    }

    const data: unknown = await response.json();
    const value =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>).store_open
        : undefined;
    const storeOpen =
      typeof value === "boolean" ? value : defaultStoreOpen(APP_ENV);

    cachedStatus = { storeOpen, expiresAt: now + STATUS_CACHE_MS };

    return storeOpen;
  } catch {
    return defaultStoreOpen(APP_ENV);
  }
}
