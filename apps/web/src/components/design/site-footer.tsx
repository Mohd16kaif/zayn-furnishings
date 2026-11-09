import { getCategories, getSettings } from "@/lib/publicApi";
import { Footer } from "./footer";

/** Server component: fetches live data once for the client footer. */
export async function SiteFooter() {
  const [categories, settings] = await Promise.all([
    getCategories(),
    getSettings(),
  ]);

  return (
    <Footer categories={categories.data} settings={settings.data} />
  );
}
