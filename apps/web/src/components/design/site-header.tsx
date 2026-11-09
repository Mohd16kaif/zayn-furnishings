import { getCategories, getSettings } from "@/lib/publicApi";
import { Navbar } from "./navbar";

/**
 * Server component: fetches the live category tree and store settings
 * once (cached/revalidated) and hands them to the client navbar.
 */
export async function SiteHeader() {
  const [categories, settings] = await Promise.all([
    getCategories(),
    getSettings(),
  ]);

  return (
    <Navbar
      categories={categories.data}
      live={categories.ok}
      settings={settings.data}
    />
  );
}
