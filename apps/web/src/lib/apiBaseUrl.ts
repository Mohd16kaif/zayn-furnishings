const DEFAULT_API_URL = "http://localhost:4000";

/**
 * Server-side API base URL.
 *
 * API_INTERNAL_URL is read when the request runs so the same build can talk to
 * the API over a private Compose network. Without it, local development keeps
 * using NEXT_PUBLIC_API_URL. Never include credentials in either value.
 */
export function apiBaseUrl(): string {
  return (
    process.env.API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API_URL
  );
}
