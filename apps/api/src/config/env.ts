import "dotenv/config";
import path from "node:path";
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

const usesLocalMedia = parsed.data.MEDIA_DRIVER === "local";
const developmentMediaDefaults =
  usesLocalMedia && appEnv === "development";
const defaultMediaDir = developmentMediaDefaults
  ? path.resolve(process.cwd(), "media-data")
  : undefined;
const defaultMediaPublicBaseUrl = developmentMediaDefaults
  ? "http://localhost:4000"
  : undefined;

export const env = {
  ...parsed.data,
  APP_ENV: appEnv,
  ADMIN_AUTH_SECRET:
    parsed.data.ADMIN_AUTH_SECRET ?? DEV_ADMIN_AUTH_SECRET,
  MEDIA_DIR: parsed.data.MEDIA_DIR ?? defaultMediaDir,
  MEDIA_PUBLIC_BASE_URL:
    parsed.data.MEDIA_PUBLIC_BASE_URL ?? defaultMediaPublicBaseUrl,
};
export type Env = typeof env;
