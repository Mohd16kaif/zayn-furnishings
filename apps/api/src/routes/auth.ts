import { and, eq, gte } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { normalizeUsPhone } from "@zayn/shared";
import { z } from "zod";
import { db } from "../db/client";
import {
  customerSessions,
  customers,
  phoneVerificationAttempts,
} from "../db/schema";
import { sendValidationError } from "../lib/adminCatalog";
import {
  generateSessionToken,
  hashSessionToken,
  requireCustomer,
  serializeCustomer,
  SESSION_TTL_MS,
} from "../lib/customerAuth";
import { phoneVerifier } from "../lib/phoneVerifier";
import {
  requestVisitorIp,
  storefrontKeyMatches,
} from "../lib/storefrontAccess";
import {
  CHECK_LOCK_MS,
  decideStartLimit,
  decideVerifyLock,
  type VerificationAttempt,
} from "../lib/verificationLimits";

const PHONE_START_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_USER_AGENT_LENGTH = 255;

const phoneSchema = z.object({
  phone: z.string().trim().min(1).max(40),
});

const verifySchema = z.object({
  phone: z.string().trim().min(1).max(40),
  code: z.string().trim().regex(/^\d{4,8}$/, "Enter the 4-8 digit code."),
});

function signInUnavailable(res: Response): void {
  res.status(503).json({ error: "Sign-in is temporarily unavailable." });
}

function tooManyAttempts(res: Response, retryAfterSeconds: number): void {
  res.set("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "Too many sign-in attempts. Please try again later.",
  });
}

async function recentStartAttempts(
  now: Date,
): Promise<VerificationAttempt[]> {
  const rows = await db!
    .select({
      phone: phoneVerificationAttempts.phone,
      ip: phoneVerificationAttempts.ip,
      kind: phoneVerificationAttempts.kind,
      success: phoneVerificationAttempts.success,
      createdAt: phoneVerificationAttempts.createdAt,
    })
    .from(phoneVerificationAttempts)
    .where(
      and(
        eq(phoneVerificationAttempts.kind, "start"),
        gte(
          phoneVerificationAttempts.createdAt,
          new Date(now.getTime() - PHONE_START_LOOKBACK_MS),
        ),
      ),
    );

  return rows;
}

async function recentFailedChecks(
  phone: string,
  now: Date,
): Promise<VerificationAttempt[]> {
  const rows = await db!
    .select({
      phone: phoneVerificationAttempts.phone,
      ip: phoneVerificationAttempts.ip,
      kind: phoneVerificationAttempts.kind,
      success: phoneVerificationAttempts.success,
      createdAt: phoneVerificationAttempts.createdAt,
    })
    .from(phoneVerificationAttempts)
    .where(
      and(
        eq(phoneVerificationAttempts.kind, "check"),
        eq(phoneVerificationAttempts.phone, phone),
        eq(phoneVerificationAttempts.success, false),
        gte(
          phoneVerificationAttempts.createdAt,
          new Date(now.getTime() - CHECK_LOCK_MS),
        ),
      ),
    );

  return rows;
}

export const authRouter = Router();

authRouter.use((req: Request, res: Response, next) => {
  res.set("Cache-Control", "no-store");

  if (!storefrontKeyMatches(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
});

authRouter.post(
  "/phone/start",
  async (req: Request, res: Response) => {
    const parsed = phoneSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const phone = normalizeUsPhone(parsed.data.phone);

    if (!phone) {
      res.status(400).json({ error: "Enter a valid US phone number." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    if (!phoneVerifier) {
      signInUnavailable(res);
      return;
    }

    const ip = requestVisitorIp(req);
    const now = new Date();

    try {
      const attempts = await recentStartAttempts(now);
      const decision = decideStartLimit(attempts, phone, ip, now);

      if (!decision.allowed) {
        tooManyAttempts(res, decision.retryAfterSeconds);
        return;
      }

      try {
        await phoneVerifier.start(phone);
      } catch (error) {
        console.error(
          "Phone verification start failed:",
          error instanceof Error ? error.message : error,
        );
        signInUnavailable(res);
        return;
      }

      await db.insert(phoneVerificationAttempts).values({
        phone,
        ip,
        kind: "start",
        success: true,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error(
        "Phone sign-in start failed:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ error: "Sign-in is temporarily unavailable." });
    }
  },
);

authRouter.post(
  "/phone/verify",
  async (req: Request, res: Response) => {
    const parsed = verifySchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const phone = normalizeUsPhone(parsed.data.phone);

    if (!phone) {
      res.status(400).json({ error: "Enter a valid US phone number." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    if (!phoneVerifier) {
      signInUnavailable(res);
      return;
    }

    const ip = requestVisitorIp(req);
    const now = new Date();

    try {
      const failures = await recentFailedChecks(phone, now);
      const lock = decideVerifyLock(failures, phone, now);

      if (!lock.allowed) {
        tooManyAttempts(res, lock.retryAfterSeconds);
        return;
      }

      let approved = false;

      try {
        approved = await phoneVerifier.check(phone, parsed.data.code);
      } catch (error) {
        console.error(
          "Phone verification check failed:",
          error instanceof Error ? error.message : error,
        );
        signInUnavailable(res);
        return;
      }

      if (!approved) {
        await db.insert(phoneVerificationAttempts).values({
          phone,
          ip,
          kind: "check",
          success: false,
        });

        res.status(400).json({
          error: "That code is incorrect or expired.",
        });
        return;
      }

      const session = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(customers)
          .values({
            phone,
            phoneVerifiedAt: now,
          })
          .onConflictDoNothing()
          .returning();

        let customer = inserted;

        if (!customer) {
          const [updated] = await tx
            .update(customers)
            .set({
              phoneVerifiedAt: now,
              updatedAt: now,
            })
            .where(eq(customers.phone, phone))
            .returning();

          customer = updated;
        }

        if (!customer) {
          throw new Error("Customer could not be created or loaded.");
        }

        await tx.insert(phoneVerificationAttempts).values({
          phone,
          ip,
          kind: "check",
          success: true,
        });

        const token = generateSessionToken();
        const userAgent = req.get("user-agent")?.slice(
          0,
          MAX_USER_AGENT_LENGTH,
        );

        await tx.insert(customerSessions).values({
          customerId: customer.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          lastSeenAt: now,
          userAgent: userAgent || null,
        });

        return { token, customer };
      });

      res.json({
        token: session.token,
        customer: serializeCustomer(session.customer),
      });
    } catch (error) {
      console.error(
        "Phone sign-in verification failed:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ error: "Sign-in is temporarily unavailable." });
    }
  },
);

authRouter.get(
  "/me",
  requireCustomer,
  (req: Request, res: Response) => {
    res.json({ customer: serializeCustomer(req.customer!) });
  },
);

authRouter.post(
  "/logout",
  requireCustomer,
  async (req: Request, res: Response) => {
    if (!db || !req.customerSessionId) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      await db
        .delete(customerSessions)
        .where(eq(customerSessions.id, req.customerSessionId));

      res.json({ ok: true });
    } catch (error) {
      console.error(
        "Customer logout failed:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ error: "Sign-out failed. Please try again." });
    }
  },
);
