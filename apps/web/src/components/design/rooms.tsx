import { Reveal } from "@/components/motion/reveal";
import { rooms } from "@/app/design-preview/preview-data";
import { ArrowRightIcon } from "./icons";
import { SmartImage } from "./smart-image";

export function Rooms({ images }: { images: Array<string | null> }) {
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
            {rooms.map((room, index) => (
              <a className="zf-room" href="#featured" key={room.name}>
                <div className="zf-room__media">
                  <SmartImage
                    src={images[index] ?? undefined}
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
                    <span className="zf-room__count">{room.pieces}</span>
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
