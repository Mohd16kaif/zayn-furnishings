import { resolveAppEnv } from "@zayn/shared";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  });

// Development-only fallback. Never use this value in staging or production.
export const DEV_ADMIN_AUTH_SECRET =
  "zayn-development-only-admin-auth-secret-do-not-use";

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ENV: optionalString,
    PORT: z.coerce.number().int().positive().default(4000),
    // Accepts any Postgres URL, including plain postgres:// URLs on localhost.
    DATABASE_URL: optionalString,
    DATABASE_SSL: z.preprocess(
      (value) => {
        if (typeof value !== "string") {
          return value;
        }

        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z.enum(["require", "disable"]).optional(),
    ),
    ADMIN_AUTH_SECRET: optionalString.refine(
      (value) => value === undefined || value.length >= 32,
      {
        message: "ADMIN_AUTH_SECRET must be at least 32 characters",
      },
    ),
    SUPABASE_URL: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_ANON_KEY: optionalString,
    OWNER_EMAIL: optionalString,
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    STOREFRONT_API_KEY: optionalString,
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: optionalString,
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    TWILIO_ACCOUNT_SID: optionalString,
    TWILIO_AUTH_TOKEN: optionalString,
    TWILIO_VERIFY_SERVICE_SID: optionalString,
  })
  .superRefine((value, ctx) => {
    const appEnv = resolveAppEnv(value.APP_ENV, value.NODE_ENV);

    if (appEnv !== "development" && !value.ADMIN_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_AUTH_SECRET"],
        message:
          "ADMIN_AUTH_SECRET is required in staging and production",
      });
    }

    if (value.NODE_ENV !== "production") {
      return;
    }

    if (!value.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }

    if (!value.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "SUPABASE_SERVICE_ROLE_KEY is required in production",
      });
    }

    if (!value.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "STRIPE_SECRET_KEY is required in production",
      });
    }

    if (!value.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "STRIPE_WEBHOOK_SECRET is required in production",
      });
    }
  });
