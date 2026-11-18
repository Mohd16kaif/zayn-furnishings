import { defaultStoreOpen, type AppEnv } from "@zayn/shared";
import { env } from "../config/env";
import { storeSettings } from "../db/schema";
import type { Executor } from "./adminCatalog";

export type StoreSettingsValues = {
  store_name: string;
  phone: string;
  email: string;
  free_delivery_threshold_cents: number | null;
  show_financing: boolean;
  store_open: boolean;
};

export function defaultStoreSettings(
  appEnv: AppEnv,
): StoreSettingsValues {
  return {
    store_name: "Zayn Furnishings",
    phone: "",
    email: "",
    free_delivery_threshold_cents: null,
    show_financing: false,
    store_open: defaultStoreOpen(appEnv),
  };
}

export function coerceSettingValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  switch (key) {
    case "store_name":
    case "phone":
    case "email":
      return typeof value === "string" ? value : undefined;
    case "free_delivery_threshold_cents":
      if (value === null) {
        return null;
      }

      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0
        ? value
        : undefined;
    case "show_financing":
    case "store_open":
      return typeof value === "boolean" ? value : undefined;
    default:
      return undefined;
  }
}

export async function readStoreSettings(
  executor: Executor,
  appEnv: AppEnv = env.APP_ENV,
): Promise<StoreSettingsValues> {
  const rows = await executor.select().from(storeSettings);
  const result: StoreSettingsValues = defaultStoreSettings(appEnv);

  for (const row of rows) {
    const value = coerceSettingValue(row.key, row.value);

    if (value === undefined) {
      continue;
    }

    switch (row.key) {
      case "store_name":
        result.store_name = value as string;
        break;
      case "phone":
        result.phone = value as string;
        break;
      case "email":
        result.email = value as string;
        break;
      case "free_delivery_threshold_cents":
        result.free_delivery_threshold_cents = value as
          | number
          | null;
        break;
      case "show_financing":
        result.show_financing = value as boolean;
        break;
      case "store_open":
        result.store_open = value as boolean;
        break;
      default:
        break;
    }
  }

  return result;
}
