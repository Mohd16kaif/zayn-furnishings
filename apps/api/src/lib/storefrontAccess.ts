import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { env } from "../config/env";

export function storefrontKeyMatches(req: Request): boolean {
  const provided = req.get("x-storefront-key");
  const expected = env.STOREFRONT_API_KEY;

  if (!provided || !expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function trustedVisitorIp(req: Request): string | null {
  if (!storefrontKeyMatches(req)) {
    return null;
  }

  const visitorIp = req.get("x-visitor-ip")?.trim();

  return visitorIp && isIP(visitorIp) ? visitorIp : null;
}

export function requestVisitorIp(req: Request): string | null {
  return trustedVisitorIp(req) ?? (req.ip?.trim() || null);
}
