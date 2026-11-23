import "dotenv/config";
import { resolveAppEnv } from "@zayn/shared";
import { z } from "zod";
import { liveStripeKeyOutsideProductionError } from "../lib/stripeKeyGuard";

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  });

const envSchema = z.object({
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
}).superRefine((value, ctx) => {
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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    z.treeifyError(parsed.error),
  );
  process.exit(1);
}

const appEnv = resolveAppEnv(parsed.data.APP_ENV, parsed.data.NODE_ENV);
const stripeKeyError = liveStripeKeyOutsideProductionError(
  appEnv,
  parsed.data.STRIPE_SECRET_KEY,
);

if (stripeKeyError) {
  console.error(stripeKeyError);
  process.exit(1);
}

export const env = { ...parsed.data, APP_ENV: appEnv };
export type Env = typeof env;
