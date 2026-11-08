"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { products } from "@/app/design-preview/preview-data";
import { Reveal } from "@/components/motion/reveal";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";
import { SmartImage } from "./smart-image";

type DragState = {
  active: boolean;
  startX: number;
  scrollLeft: number;
};

export function FeaturedCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ active: false, startX: 0, scrollLeft: 0 });
  const [dragging, setDragging] = useState(false);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    function updateEdges() {
      if (!track) {
        return;
      }
      setCanPrev(track.scrollLeft > 8);
      setCanNext(track.scrollLeft + track.clientWidth < track.scrollWidth - 8);
    }

    updateEdges();
    track.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);

    return () => {
      track.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, []);

  function scrollByCard(direction: -1 | 1) {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const card = track.querySelector<HTMLElement>(".zf-product");
    const distance = card ? card.offsetWidth + 20 : track.clientWidth * 0.8;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    track.scrollBy({
      left: distance * direction,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") {
      return;
    }

    const track = trackRef.current;

    if (!track) {
      return;
    }

    dragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: track.scrollLeft,
    };
    setDragging(true);
    track.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active) {
      return;
    }

    const track = trackRef.current;

    if (!track) {
      return;
    }

    const distance = event.clientX - dragRef.current.startX;
    track.scrollLeft = dragRef.current.scrollLeft - distance;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active) {
      return;
    }
    dragRef.current.active = false;
    setDragging(false);
    const track = trackRef.current;
    if (track?.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section className="zf-section" id="featured" aria-labelledby="featured-title">
      <div className="zf-container">
        <Reveal variant="fade">
          <div className="zf-carousel-head">
            <div className="zf-carousel-head__copy">
              <span className="zf-eyebrow">Featured pieces</span>
              <h2 className="zf-heading" id="featured-title">
                The pieces everyone is living with.
              </h2>
              <p className="zf-lede" style={{ maxWidth: 540 }}>
                Sample product cards for the preview. In the storefront these
                will connect to live inventory, finishes, and lead times.
              </p>
            </div>
            <div className="zf-carousel-nav">
              <button
                type="button"
                className="zf-round-btn"
                aria-label="Previous pieces"
                disabled={!canPrev}
                onClick={() => scrollByCard(-1)}
              >
                <ArrowLeftIcon />
              </button>
              <button
                type="button"
                className="zf-round-btn"
                aria-label="Next pieces"
                disabled={!canNext}
                onClick={() => scrollByCard(1)}
              >
                <ArrowRightIcon />
              </button>
            </div>
          </div>
        </Reveal>

        <div
          ref={trackRef}
          className={`zf-carousel${dragging ? " is-dragging" : ""}`}
          role="region"
          aria-label="Featured pieces carousel"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
          onDragStart={(event) => event.preventDefault()}
        >
          {products.map((product) => (
            <article className="zf-product" key={product.name}>
              <div className="zf-product__media">
                <SmartImage
                  alt={`${product.name} product photo`}
                  sizes="(max-width: 560px) 78vw, 320px"
                  tone={product.tone}
                  label="Product"
                />
                {product.soldOut ? (
                  <span className="zf-product__badge">Sold out</span>
                ) : null}
                <button
                  type="button"
                  className="zf-quickview"
                  aria-label={`Quick view ${product.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  Quick view
                </button>
              </div>
              <div className="zf-product__body">
                <span className="zf-product__meta">{product.category}</span>
                <h3 className="zf-product__name">{product.name}</h3>
                <div
                  className={`zf-product__price${
                    product.salePrice ? " zf-product__price--sale" : ""
                  }`}
                >
                  {product.salePrice ? (
                    <>
                      <s>{product.price}</s>
                      <strong>{product.salePrice}</strong>
                      <span className="zf-product__meta">Sale</span>
                    </>
                  ) : (
                    <strong>{product.price}</strong>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
