import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { renderTokens } from "@zayn/shared";
import {
  getContentHome,
  getSettings,
  PUBLIC_CONTENT_TAG,
  PUBLIC_SETTINGS_TAG,
} from "@/lib/publicApi";

async function loadAnnouncementData() {
  "use cache";
  cacheLife("minutes");
  cacheTag(PUBLIC_CONTENT_TAG, PUBLIC_SETTINGS_TAG);

  return Promise.all([getContentHome(), getSettings()]);
}

/**
 * Live announcement bar text (first active announcement block).
 * Renders nothing when the API has no announcement or is unavailable.
 * Token replacements use the live free-delivery threshold.
 */
export async function AnnouncementBar() {
  const [contentResult, settingsResult] = await loadAnnouncementData();
  const announcement = contentResult.data.announcement?.[0];
  const settings = settingsResult.data;
  const title = renderTokens(announcement?.title, settings).trim();
  const subtitle = renderTokens(
    announcement?.subtitle,
    settings,
  ).trim();
  const buttonText = announcement?.button_text?.trim() ?? "";
  const linkUrl = announcement?.link_url?.trim() ?? "";
  const showLink = Boolean(buttonText && linkUrl);

  if (!title && !subtitle && !showLink) {
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
      {showLink ? (
        linkUrl.startsWith("/") ? (
          <Link className="zf-announce__link" href={linkUrl}>
            {buttonText}
          </Link>
        ) : (
          <a
            className="zf-announce__link"
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {buttonText}
          </a>
        )
      ) : null}
    </div>
  );
}
