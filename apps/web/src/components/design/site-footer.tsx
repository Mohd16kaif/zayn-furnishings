import { cacheLife, cacheTag } from "next/cache";
import {
  getCategories,
  getSettings,
  PUBLIC_CATEGORIES_TAG,
  PUBLIC_SETTINGS_TAG,
} from "@/lib/publicApi";
import { Footer } from "./footer";

async function loadFooterData() {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_CATEGORIES_TAG, PUBLIC_SETTINGS_TAG);

  return Promise.all([getCategories(), getSettings()]);
}

/** Server component: fetches live data once for the client footer. */
export async function SiteFooter() {
  const [categories, settings] = await loadFooterData();

  return (
    <Footer categories={categories.data} settings={settings.data} />
  );
}
