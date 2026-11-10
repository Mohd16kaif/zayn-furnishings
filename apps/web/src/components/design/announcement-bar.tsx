import { renderTokens } from "@zayn/shared";
import { getContentHome, getSettings } from "@/lib/publicApi";

/**
 * Live announcement bar text (first active announcement block).
 * Renders nothing when the API has no announcement or is unavailable.
 * Token replacements use the live free-delivery threshold.
 */
export async function AnnouncementBar() {
  const [contentResult, settingsResult] = await Promise.all([
    getContentHome(),
    getSettings(),
  ]);
  const announcement = contentResult.data.announcement?.[0];
  const settings = settingsResult.data;
  const title = renderTokens(announcement?.title, settings).trim();
  const subtitle = renderTokens(
    announcement?.subtitle,
    settings,
  ).trim();

  if (!title && !subtitle) {
    return null;
  }

  return (
    <div className="zf-announce">
      {title ? (
        <span className="zf-announce__title">{title}</span>
      ) : null}
      {subtitle ? (
        <span className="zf-announce__sub">{subtitle}</span>
      ) : null}
    </div>
  );
}
