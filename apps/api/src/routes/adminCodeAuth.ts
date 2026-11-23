import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { getEmailSender } from "../emails/sender";
import { renderAdminLoginCode } from "../emails/templates/adminLoginCode";
import { maskEmailAddress } from "../emails/outbox";
import {
  ADMIN_LOGIN_CODE_TTL_MS,
  normalizeAdminEmail,
} from "../lib/adminAuth";
import {
  adminCodeEmailRateLimiter,
  adminCodeIpRateLimiter,
  adminCodeResendGapLimiter,
} from "../lib/adminAuthRateLimits";
import {
  requestAdminLoginCode,
  revokeAdminSession,
  verifyAdminLoginCode,
} from "../lib/adminAuthService";
import { readStoreSettings } from "../lib/storeSettings";
import {
  requestVisitorIp,
  storefrontKeyMatches,
} from "../lib/storefrontAccess";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;

const GENERIC_CODE_REQUEST_RESPONSE = {
  message: "If this email belongs to an active admin, a sign-in code was sent.",
};

const GENERIC_CODE_FAILURE = {
  error: "Invalid or expired code.",
};

const UNAUTHORIZED = { error: "Unauthorized" };

export const adminCodeAuthRouter = Router();

adminCodeAuthRouter.use((req: Request, res: Response, next) => {
  res.set("Cache-Control", "no-store");

  if (!storefrontKeyMatches(req)) {
    res.status(401).json(UNAUTHORIZED);
    return;
  }

  next();
});

adminCodeAuthRouter.post(
  "/auth/code/request",
  adminCodeIpRateLimiter,
  adminCodeEmailRateLimiter,
  adminCodeResendGapLimiter,
  async (req: Request, res: Response) => {
    const email = normalizeAdminEmail(
      (req.body as { email?: unknown } | undefined)?.email,
    );

    if (!db || !email || !EMAIL_PATTERN.test(email)) {
      res.status(200).json(GENERIC_CODE_REQUEST_RESPONSE);
      return;
    }

    try {
      const requestedIp = requestVisitorIp(req);
      const result = await requestAdminLoginCode(db, {
        email,
        requestedIp,
        userAgent: req.get("user-agent") ?? null,
      });

      if (!result.sent) {
        res.status(200).json(GENERIC_CODE_REQUEST_RESPONSE);
        return;
      }

      const settings = await readStoreSettings(db);
      const rendered = renderAdminLoginCode({
        code: result.code,
        expiresMinutes: ADMIN_LOGIN_CODE_TTL_MS / (60 * 1000),
        storeName: settings.store_name,
        requestedIp,
      });

      await getEmailSender().send({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fromName: settings.store_name,
      });

      if (
        env.APP_ENV === "development" &&
        (!env.RESEND_API_KEY || !env.EMAIL_FROM)
      ) {
        console.log(
          `DEV ONLY admin login code for ${maskEmailAddress(email)}: ${result.code}`,
        );
      }
    } catch (error) {
      console.error(
        "Admin code request failed:",
        maskEmailAddress(email),
        error instanceof Error ? error.message : error,
      );
    }

    res.status(200).json(GENERIC_CODE_REQUEST_RESPONSE);
  },
);

adminCodeAuthRouter.post(
  "/auth/code/verify",
  async (req: Request, res: Response) => {
    const email = normalizeAdminEmail(
      (req.body as { email?: unknown } | undefined)?.email,
    );
    const rawCode = (req.body as { code?: unknown } | undefined)?.code;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";

    if (!db || !email || !CODE_PATTERN.test(code)) {
      res.status(401).json(GENERIC_CODE_FAILURE);
      return;
    }

    try {
      const result = await verifyAdminLoginCode(db, {
        email,
        code,
        requestedIp: requestVisitorIp(req),
        userAgent: req.get("user-agent") ?? null,
      });

      if (!result.ok) {
        res.status(401).json(GENERIC_CODE_FAILURE);
        return;
      }

      res.json({
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt.toISOString(),
        admin: {
          email: result.admin.email,
          name: result.admin.name,
          role: result.admin.role,
        },
      });
    } catch (error) {
      console.error(
        "Admin code verification failed:",
        maskEmailAddress(email),
        error instanceof Error ? error.message : error,
      );

      res.status(401).json(GENERIC_CODE_FAILURE);
    }
  },
);

adminCodeAuthRouter.post(
  "/auth/logout",
  async (req: Request, res: Response) => {
    const sessionToken = req.get("x-admin-session")?.trim();

    if (!db || !sessionToken) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }

    try {
      const revoked = await revokeAdminSession(db, sessionToken);

      if (!revoked) {
        res.status(401).json(UNAUTHORIZED);
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      console.error(
        "Admin logout failed:",
        error instanceof Error ? error.message : error,
      );

      res.status(401).json(UNAUTHORIZED);
    }
  },
);
