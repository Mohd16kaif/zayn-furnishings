export const CONTENT_TYPES = [
  "announcement",
  "hero",
  "promo_card",
  "room_tile",
  "info_card",
  "faq",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LIMITS: Record<ContentType, number> = {
  announcement: 3,
  hero: 6,
  promo_card: 2,
  room_tile: 8,
  info_card: 6,
  faq: 20,
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  announcement: "announcement",
  hero: "hero",
  promo_card: "promo card",
  room_tile: "room tile",
  info_card: "info card",
  faq: "FAQ",
};

export const FREE_DELIVERY_TOKEN = "{{free_delivery_threshold}}";

export function isContentType(value: unknown): value is ContentType {
  return (
    typeof value === "string" &&
    (CONTENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Returns an error message for an invalid content link, or null when valid.
 * Empty links are allowed, relative paths must start with a single "/",
 * and absolute URLs must use https.
 */
export function validateContentLink(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const link = value.trim();

  if (!link) {
    return null;
  }

  const normalized = link.replace(/\\/g, "/");

  if (normalized.startsWith("//")) {
    return "Enter a path starting with / or an https:// URL.";
  }

  if (normalized.startsWith("/")) {
    return null;
  }

  const httpsMatch =
    /^https:\/\/([^/?#\s]+)(?:[/?#][^\s]*)?$/i.exec(normalized);

  if (httpsMatch?.[1]) {
    return null;
  }

  return "Enter a path starting with / or an https:// URL.";
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateContentDateRange(
  startsAt: Date | string | null | undefined,
  endsAt: Date | string | null | undefined,
): string | null {
  const start = toDate(startsAt);
  const end = toDate(endsAt);

  if (start && end && end.getTime() <= start.getTime()) {
    return "End date must be after the start date.";
  }

  return null;
}

export function containsFreeDeliveryToken(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && value.includes(FREE_DELIVERY_TOKEN);
}

export function isFreeDeliveryTokenAllowed(
  type: string,
  field: string,
): boolean {
  return (
    type === "announcement" &&
    (field === "title" || field === "subtitle")
  );
}
