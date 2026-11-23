export const ADMIN_PROXY_MAX_BODY_BYTES = 45 * 1024 * 1024;

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export type AdminProxyPathResult =
  | { ok: true; segments: string[] }
  | { ok: false };

export function validateAdminProxyPath(
  segments: string[],
  rawPathname: string,
): AdminProxyPathResult {
  const lowerPathname = rawPathname.toLowerCase();

  if (
    lowerPathname.includes("%2e") ||
    lowerPathname.includes("%2f") ||
    lowerPathname.includes("%5c") ||
    rawPathname.includes("//")
  ) {
    return { ok: false };
  }

  if (!Array.isArray(segments) || segments.length < 2) {
    return { ok: false };
  }

  if (segments[0] !== "admin") {
    return { ok: false };
  }

  // Express route matching is case-insensitive by default, so block every
  // casing of the auth segment, not just the lowercase spelling.
  if (segments[1].toLowerCase() === "auth") {
    return { ok: false };
  }

  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("..") ||
      !SAFE_SEGMENT.test(segment)
    ) {
      return { ok: false };
    }
  }

  return { ok: true, segments };
}

export function buildAdminProxyRequestHeaders(input: {
  contentType: string | null;
  sessionToken: string;
  storefrontKey: string | null;
  visitorIp: string | null;
}): Headers {
  const headers = new Headers();

  if (input.contentType) {
    headers.set("content-type", input.contentType);
  }

  if (input.storefrontKey) {
    headers.set("x-storefront-key", input.storefrontKey);
  }

  if (input.visitorIp) {
    headers.set("x-visitor-ip", input.visitorIp);
  }

  headers.set("x-admin-session", input.sessionToken);

  return headers;
}

export function declaredBodyTooLarge(request: Request): boolean {
  const raw = request.headers.get("content-length");

  if (!raw) {
    return false;
  }

  const length = Number(raw);

  return Number.isFinite(length) && length > ADMIN_PROXY_MAX_BODY_BYTES;
}

export function createLimitedBodyStream(
  body: ReadableStream<Uint8Array>,
  onExceeded: () => void,
): ReadableStream<Uint8Array> {
  let total = 0;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;

        if (total > ADMIN_PROXY_MAX_BODY_BYTES) {
          onExceeded();
          controller.error(
            new Error("Admin proxy request body is too large."),
          );
          return;
        }

        controller.enqueue(chunk);
      },
    }),
  );
}
