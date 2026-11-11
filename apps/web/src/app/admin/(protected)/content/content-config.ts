import { CONTENT_TYPE_LIMITS, type ContentType } from "@zayn/shared";

export type ContentTab = {
  type: ContentType;
  label: string;
  singular: string;
  plural: string;
  showImage: boolean;
};

export const CONTENT_TABS: ContentTab[] = [
  {
    type: "announcement",
    label: "Announcement",
    singular: "announcement",
    plural: "announcements",
    showImage: false,
  },
  {
    type: "hero",
    label: "Homepage banners",
    singular: "banner",
    plural: "banners",
    showImage: true,
  },
  {
    type: "room_tile",
    label: "Shop by room",
    singular: "room tile",
    plural: "room tiles",
    showImage: true,
  },
  {
    type: "info_card",
    label: "Info cards",
    singular: "info card",
    plural: "info cards",
    showImage: false,
  },
  {
    type: "faq",
    label: "FAQ",
    singular: "FAQ",
    plural: "FAQs",
    showImage: false,
  },
];

export function contentTab(type: ContentType): ContentTab {
  return (
    CONTENT_TABS.find((tab) => tab.type === type) ?? CONTENT_TABS[0]
  );
}

export function contentLimit(type: ContentType): number {
  return CONTENT_TYPE_LIMITS[type];
}
