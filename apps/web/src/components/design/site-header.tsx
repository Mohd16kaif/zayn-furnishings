import { cacheLife, cacheTag } from "next/cache";
import {
  getCategories,
  getProducts,
  getSettings,
  PUBLIC_CATEGORIES_TAG,
  PUBLIC_SETTINGS_TAG,
} from "@/lib/publicApi";
import { Navbar } from "./navbar";

/**
 * Server component data is cached so Cache Components can validate the
 * storefront shell without treating fetch internals (which read the current
 * time) as blocking. The cache lifetime matches the existing 60s refresh.
 */
async function loadHeaderData() {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_CATEGORIES_TAG, PUBLIC_SETTINGS_TAG);

  return Promise.all([
    getCategories(),
    getSettings(),
    getProducts({ pageSize: 1, sort: "newest" }),
    getProducts({ pageSize: 1, onSale: true }),
  ]);
}

/**
 * Server component: fetches the live category tree and store settings
 * once (cached/revalidated) and hands them to the client navbar.
 *
 * It also asks the products endpoint for one row twice (page_size=1) so
 * the menu can conditionally show New Arrivals and Sale without shipping
 * any demo content. Both queries share the same 60s revalidation cache.
 */
export async function SiteHeader() {
  const [categories, settings, newest, sale] = await loadHeaderData();

  return (
    <Navbar
      categories={categories.data}
      live={categories.ok}
      settings={settings.data}
      showNewArrivals={newest.ok && newest.data.total > 0}
      showSale={sale.ok && sale.data.total > 0}
    />
  );
}
