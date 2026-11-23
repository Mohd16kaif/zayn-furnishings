import "dotenv/config";
import { resolveAppEnv } from "@zayn/shared";
import { z } from "zod";
import { liveStripeKeyOutsideProductionError } from "../lib/stripeKeyGuard";
import { DEV_ADMIN_AUTH_SECRET, envSchema } from "./envSchema";

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

export const adminAuthSecretIsDevFallback =
  !parsed.data.ADMIN_AUTH_SECRET;

export const env = {
  ...parsed.data,
  APP_ENV: appEnv,
  ADMIN_AUTH_SECRET:
    parsed.data.ADMIN_AUTH_SECRET ?? DEV_ADMIN_AUTH_SECRET,
};
export type Env = typeof env;
