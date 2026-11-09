"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
} from "@/components/design/icons";
import { SmartImage } from "@/components/design/smart-image";

export type ProductGalleryImage = {
  id: string;
  url: string;
  alt_text: string | null;
};

export function ProductGallery({
  name,
  images,
}: {
  name: string;
  images: ProductGalleryImage[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const hasImages = images.length > 0;
  const safeIndex = hasImages ? Math.min(activeIndex, images.length - 1) : 0;
  const current = hasImages ? images[safeIndex] : null;

  function showNext() {
    if (!hasImages) {
      return;
    }

    setActiveIndex((index) => (index + 1) % images.length);
  }

  function showPrevious() {
    if (!hasImages) {
      return;
    }

    setActiveIndex(
      (index) => (index - 1 + images.length) % images.length,
    );
  }

  useEffect(() => {
    if (!lightboxOpen) {
      return;
    }

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    function focusable(): HTMLElement[] {
      if (!dialogRef.current) {
        return [];
      }

      return Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightboxOpen(false);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % images.length);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + images.length) % images.length,
        );
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const items = focusable();

      if (items.length === 0) {
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [lightboxOpen, images.length]);

  return (
    <div className="zf-gallery">
      {current ? (
        <button
          ref={triggerRef}
          type="button"
          className="zf-gallery__main"
          onClick={() => setLightboxOpen(true)}
          aria-label={`Open ${name} image ${safeIndex + 1} of ${images.length} in full screen`}
        >
          <SmartImage
            src={current.url}
            alt={current.alt_text ?? `${name} image ${safeIndex + 1}`}
            sizes="(max-width: 940px) 100vw, 56vw"
            priority
            tone={2}
            label={name}
          />
        </button>
      ) : (
        <div className="zf-gallery__main zf-gallery__main--empty">
          <SmartImage
            alt={`${name} image unavailable`}
            sizes="(max-width: 940px) 100vw, 56vw"
            tone={2}
            label={name}
          />
        </div>
      )}

      {images.length > 1 ? (
        <ul className="zf-gallery__thumbs" aria-label={`${name} images`}>
          {images.map((image, index) => {
            const selected = index === safeIndex;

            return (
              <li key={image.id}>
                <button
                  type="button"
                  className={`zf-gallery__thumb${selected ? " is-active" : ""}`}
                  aria-label={`Show ${name} image ${index + 1} of ${images.length}`}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => setActiveIndex(index)}
                >
                  <SmartImage
                    src={image.url}
                    alt={`${name} thumbnail ${index + 1}`}
                    sizes="96px"
                    tone={2}
                    label={name}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {lightboxOpen && current ? (
        <div className="zf-lightbox">
          <button
            type="button"
            className="zf-lightbox__scrim"
            aria-label="Close image viewer"
            onClick={() => setLightboxOpen(false)}
          />

          <div
            ref={dialogRef}
            className="zf-lightbox__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${name} image viewer`}
          >
            <div className="zf-lightbox__bar">
              <span className="zf-lightbox__count">
                {safeIndex + 1} / {images.length}
              </span>
              <button
                ref={closeRef}
                type="button"
                className="zf-icon-btn zf-lightbox__close"
                aria-label="Close image viewer"
                onClick={() => setLightboxOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="zf-lightbox__media">
              <SmartImage
                src={current.url}
                alt={current.alt_text ?? `${name} image ${safeIndex + 1}`}
                sizes="92vw"
                tone={2}
                label={name}
              />
            </div>

            {images.length > 1 ? (
              <div className="zf-lightbox__nav">
                <button
                  type="button"
                  className="zf-round-btn"
                  aria-label="Previous image"
                  onClick={showPrevious}
                >
                  <ArrowLeftIcon />
                </button>
                <button
                  type="button"
                  className="zf-round-btn"
                  aria-label="Next image"
                  onClick={showNext}
                >
                  <ArrowRightIcon />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
