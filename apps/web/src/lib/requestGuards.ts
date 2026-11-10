import { isIP } from "node:net";

/**
 * Visitor IP used only for server-to-server forwarding to the API.
 * The API trusts this header only when the storefront key also matches.
 */
export function getVisitorIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first && isIP(first)) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();

  return realIp && isIP(realIp) ? realIp : null;
}

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Small per-IP limiter for the Next proxy handlers.
 *
 * In-memory buckets are per server instance and reset on cold starts or
 * deploys; the API's limiter remains the durable backstop.
 */
export function createInMemoryRateLimiter(
  limit: number,
  windowMs = 60 * 1000,
) {
  const buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  return {
    check(key: string): RateLimitDecision {
      const now = Date.now();

      if (buckets.size > 5000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) {
            buckets.delete(bucketKey);
          }
        }

        if (buckets.size > 5000) {
          buckets.clear();
        }
      }

      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });

        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((bucket.resetAt - now) / 1000),
          ),
        };
      }

      bucket.count += 1;

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
