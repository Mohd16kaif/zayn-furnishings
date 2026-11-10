/**
 * Static images that actually exist in public/images/home.
 * Keep this list in sync with that folder; only these paths may render an
 * <img>, so a missing file falls back to the warm gradient placeholder
 * without making a failed network request.
 */
export const HOME_IMAGES = {
  hero1: "/images/home/hero-1.jpg",
  hero2: "/images/home/hero-2.jpg",
  roomBedroom: "/images/home/room-bedroom.jpg",
  roomDining: "/images/home/room-dining.jpg",
  roomLiving: "/images/home/room-living.jpg",
  roomOffice: "/images/home/room-office.jpg",
} as const;

const AVAILABLE_HOME_IMAGES = new Set<string>(Object.values(HOME_IMAGES));

export function availableHomeImage(
  src: string | null | undefined,
): string | undefined {
  return src && AVAILABLE_HOME_IMAGES.has(src) ? src : undefined;
}
