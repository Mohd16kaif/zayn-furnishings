import { and, eq, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db/client";
import { adminUsers } from "../db/schema";
import { getSupabaseAnon } from "../lib/supabase";
import { requireAdmin } from "../middleware/requireAdmin";

const GENERIC_OTP_RESPONSE = {
  message: "If this email is registered, a code was sent",
};

const otpRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
});

const otpIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const otpEmailRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: string }).email ?? "";
    return `email:${email.toLowerCase()}`;
  },
  message: { error: "Too many requests. Please try again later." },
});

function validateOtpRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const parsed = otpRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }

  req.body = parsed.data;
  next();
}

export const adminAuthRouter = Router();

adminAuthRouter.post(
  "/auth/otp/request",
  otpIpRateLimiter,
  validateOtpRequest,
  otpEmailRateLimiter,
  async (req: Request, res: Response) => {
    const email = (req.body as { email: string }).email;

    try {
      if (db) {
        const [admin] = await db
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(
            and(
              eq(adminUsers.isActive, true),
              sql`lower(${adminUsers.email}) = ${email}`,
            ),
          )
          .limit(1);

        if (admin) {
          await getSupabaseAnon().auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
          });
        }
      }
    } catch (error) {
      console.error(
        "OTP request failed:",
        error instanceof Error ? error.message : error,
      );
    }

    res.status(200).json(GENERIC_OTP_RESPONSE);
  },
);

adminAuthRouter.get("/me", requireAdmin, (req: Request, res: Response) => {
  if (!req.admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(req.admin);
});
