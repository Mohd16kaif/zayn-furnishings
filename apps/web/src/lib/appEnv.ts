import { resolveAppEnv } from "@zayn/shared";

export const APP_ENV = resolveAppEnv(
  process.env.NEXT_PUBLIC_APP_ENV,
  process.env.NODE_ENV,
);

export const IS_STAGING = APP_ENV === "staging";
