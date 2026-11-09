import { rooms as previewRooms } from "@/app/design-preview/preview-data";
import { Reveal } from "@/components/motion/reveal";
import { ArrowRightIcon } from "@/components/design/icons";
import { SmartImage } from "@/components/design/smart-image";

export type RoomTone = 1 | 2 | 3 | 4 | 5 | 6;

export type RoomTile = {
  name: string;
  href: string;
  /** Pre-formatted piece count (e.g. "2 pieces"); hidden when null. */
  count?: string | null;
  tone: RoomTone;
  image?: string | null;
};

const PREVIEW_TILES: RoomTile[] = previewRooms.map((room) => ({
  name: room.name,
  href: "#featured",
  count: room.pieces,
  tone: room.tone,
  image: null,
}));

export function Rooms({
  images = [],
  tiles = PREVIEW_TILES,
}: {
  images?: Array<string | null>;
  tiles?: RoomTile[];
}) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <section className="zf-section" id="rooms" aria-labelledby="rooms-title">
      <div className="zf-container">
        <Reveal className="zf-section-head" variant="fade">
          <div className="zf-section-head__copy">
            <span className="zf-eyebrow">Shop by room</span>
            <h2 className="zf-heading" id="rooms-title">
              Rooms that feel collected, never staged.
            </h2>
          </div>
          <p className="zf-lede" style={{ maxWidth: 380 }}>
            Start with a room, then let each piece find its place. Every
            collection is built to layer easily with what you already love.
          </p>
        </Reveal>

        <Reveal variant="rise">
          <div className="zf-rooms">
            {tiles.map((room, index) => (
              <a className="zf-room" href={room.href} key={room.name}>
                <div className="zf-room__media">
                  <SmartImage
                    src={room.image ?? images[index] ?? undefined}
                    alt={`${room.name} collection`}
                    sizes="(max-width: 760px) 50vw, (max-width: 1023px) 40vw, 33vw"
                    tone={room.tone}
                    label={room.name}
                  />
                </div>
                <span className="zf-room__shade" aria-hidden="true" />
                <span className="zf-room__content">
                  <span>
                    <span className="zf-room__name">{room.name}</span>
                    {room.count ? (
                      <span className="zf-room__count">{room.count}</span>
                    ) : null}
                  </span>
                  <span className="zf-room__explore">
                    <span>Explore</span>
                    <ArrowRightIcon aria-hidden="true" />
                  </span>
                </span>
              </a>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
