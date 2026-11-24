const DEV_MEDIA_ORIGIN = "http://localhost:4000";

function configuredMediaOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.trim();

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_MEDIA_ORIGIN;
  }

  return null;
}

/**
 * Convert absolute API media URLs whose origin is the configured public media
 * base into site-relative /media paths. The Next rewrite proxies those paths
 * to the API inside the stack, while Caddy still serves /media directly to
 * browsers. Non-media and foreign URLs are returned unchanged.
 */
export function resolveMediaImageSrc(
  src: string | null | undefined,
): string | undefined {
  if (!src) {
    return undefined;
  }

  if (src.startsWith("/")) {
    return src;
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return src;
  }

  if (url.search || url.hash) {
    return src;
  }

  if (!url.pathname.startsWith("/media/")) {
    return src;
  }

  const mediaOrigin = configuredMediaOrigin();

  if (!mediaOrigin || url.origin !== mediaOrigin) {
    return src;
  }

  return url.pathname;
}
