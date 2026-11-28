export const PAGES_PUBLISHED = {
  about: false,
  contact: false,
  faq: false,
  delivery: false,
  returns: false,
  privacy: false,
  terms: false,
  accessibility: false,
} as const;

export type PublishedPageKey = keyof typeof PAGES_PUBLISHED;

export function isPagePublished(key: PublishedPageKey): boolean {
  return PAGES_PUBLISHED[key];
}

// The owner's content blocks of type "page" may later feed these routes.
// Do not wire that until real, approved text exists.
