import type { Metadata } from "next";
import { isPagePublished, type PublishedPageKey } from "@/config/pages";

export const SITE_NAME = "Zayn Furnishings";
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;
export const MAX_TITLE_LENGTH = 60;
export const MAX_TITLE_SEGMENT = MAX_TITLE_LENGTH - ` | ${SITE_NAME}`.length;
export const MIN_DESCRIPTION_LENGTH = 50;
export const MAX_DESCRIPTION_LENGTH = 160;

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function trimAtWord(
  value: string,
  maxLength: number,
): string {
  const cleaned = cleanText(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const slice = cleaned.slice(0, Math.max(1, maxLength - 1));
  const lastSpace = slice.lastIndexOf(" ");

  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd()}\u2026`;
}

export function titleSegment(value: string): string {
  return trimAtWord(value, MAX_TITLE_SEGMENT);
}

export function descriptionText(value: string): string {
  return trimAtWord(value, MAX_DESCRIPTION_LENGTH);
}

export function fallbackDescription(
  name: string,
  kind: "product" | "category",
): string {
  return kind === "product"
    ? `Shop ${name} at ${SITE_NAME}. View product details and available pieces.`
    : `Shop ${name} at ${SITE_NAME}. Browse the collection and view available pieces.`;
}

export function fitDescription(
  candidates: Array<string | null | undefined>,
  fallback: string,
): string {
  const fallbackText = descriptionText(fallback);

  for (const candidate of candidates) {
    const cleaned = cleanText(candidate);

    if (cleaned.length >= MIN_DESCRIPTION_LENGTH) {
      return descriptionText(cleaned);
    }
  }

  return fallbackText;
}

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  absoluteTitle?: boolean;
  image?: string | null;
  imageAlt?: string;
  type?: "website" | "article";
};

export function buildPageMetadata({
  title,
  description,
  path,
  noindex = false,
  absoluteTitle = false,
  image = null,
  imageAlt,
  type = "website",
}: PageMetadataOptions): Metadata {
  const finalTitle = absoluteTitle
    ? title
    : `${title} | ${SITE_NAME}`;
  const finalDescription = descriptionText(description);

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description: finalDescription,
    alternates: { canonical: path },
    ...(noindex
      ? {
          robots: {
            index: false,
            follow: false,
            googleBot: {
              index: false,
              follow: false,
            },
          },
        }
      : {}),
    openGraph: {
      title: finalTitle,
      description: finalDescription,
      url: path,
      siteName: SITE_NAME,
      type,
      ...(image
        ? {
            images: [
              {
                url: image,
                alt: imageAlt ?? title,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: finalTitle,
      description: finalDescription,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export function placeholderPageMetadata(
  key: PublishedPageKey,
  title: string,
  description: string,
): Metadata {
  const published = isPagePublished(key);

  return buildPageMetadata({
    title,
    description,
    path: `/${key}`,
    noindex: !published,
  });
}
