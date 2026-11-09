import { getContentHome } from "@/lib/publicApi";

/**
 * Live announcement bar text (first active announcement block).
 * Renders nothing when the API has no announcement or is unavailable.
 */
export async function AnnouncementBar() {
  const { data } = await getContentHome();
  const announcement = data.announcement?.[0]?.title;

  if (!announcement) {
    return null;
  }

  return <div className="zf-announce">{announcement}</div>;
}
