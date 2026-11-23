import type { Request } from "express";
import { rateLimit } from "express-rate-limit";
import { normalizeAdminEmail } from "./adminAuth";

export const ADMIN_CODE_IP_LIMIT = 10;
export const ADMIN_CODE_IP_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_CODE_EMAIL_LIMIT = 5;
export const ADMIN_CODE_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_CODE_RESEND_GAP_MS = 60 * 1000;

const RATE_LIMIT_MESSAGE = {
  error: "Too many requests. Please try again later.",
};

function emailKey(req: Request): string {
  const email = normalizeAdminEmail(
    (req.body as { email?: unknown } | undefined)?.email,
  );

  return `admin-code-email:${email ?? "missing"}`;
}

export const adminCodeIpRateLimiter = rateLimit({
  windowMs: ADMIN_CODE_IP_WINDOW_MS,
  limit: ADMIN_CODE_IP_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});

export const adminCodeEmailRateLimiter = rateLimit({
  windowMs: ADMIN_CODE_EMAIL_WINDOW_MS,
  limit: ADMIN_CODE_EMAIL_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: emailKey,
  message: RATE_LIMIT_MESSAGE,
});

export const adminCodeResendGapLimiter = rateLimit({
  windowMs: ADMIN_CODE_RESEND_GAP_MS,
  limit: 1,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: emailKey,
  message: RATE_LIMIT_MESSAGE,
});
