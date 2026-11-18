export const APP_ENV_VALUES = [
  "development",
  "staging",
  "production",
] as const;

export type AppEnv = (typeof APP_ENV_VALUES)[number];

export function isAppEnv(value: unknown): value is AppEnv {
  return (
    typeof value === "string" &&
    (APP_ENV_VALUES as readonly string[]).includes(value)
  );
}

export function resolveAppEnv(
  appEnv: string | null | undefined,
  nodeEnv: string | null | undefined,
): AppEnv {
  const normalized =
    typeof appEnv === "string" ? appEnv.trim().toLowerCase() : "";

  if (isAppEnv(normalized)) {
    return normalized;
  }

  return nodeEnv === "production" ? "production" : "development";
}

export function defaultStoreOpen(appEnv: AppEnv): boolean {
  return appEnv !== "production";
}
