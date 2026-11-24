import { env } from "../config/env";
import { validateMediaPath, type MediaDriverName } from "./mediaStorage";

export type MediaUrlConfig = {
  driver: MediaDriverName;
  publicBaseUrl?: string | null;
};

const DEFAULT_MEDIA_URL_CONFIG: MediaUrlConfig = {
  driver: env.MEDIA_DRIVER,
  publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
};

/**
 * Resolve the URL that should be returned to clients.
 *
 * The database stores the absolute URL that existed at upload time. With the
 * local driver, that URL can go stale when MEDIA_PUBLIC_BASE_URL changes, so
 * rebuild it from the storage path. The Supabase driver, legacy rows without
 * a storage path, and invalid paths keep the stored URL unchanged.
 */
export function resolveMediaUrl(
  storagePath: string | null | undefined,
  storedUrl: string | null | undefined,
  config: MediaUrlConfig = DEFAULT_MEDIA_URL_CONFIG,
): string | null {
  const fallback = storedUrl ?? null;

  if (config.driver !== "local") {
    return fallback;
  }

  if (typeof storagePath !== "string" || storagePath.length === 0) {
    return fallback;
  }

  if (!config.publicBaseUrl) {
    return fallback;
  }

  let base: URL;

  try {
    base = new URL(config.publicBaseUrl);
  } catch {
    return fallback;
  }

  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return fallback;
  }

  if (base.username || base.password || base.search || base.hash) {
    return fallback;
  }

  try {
    validateMediaPath(storagePath);
  } catch {
    return fallback;
  }

  const basePath = base.pathname.replace(/\/+$/, "");

  return `${base.origin}${basePath}/media/${storagePath}`;
}
