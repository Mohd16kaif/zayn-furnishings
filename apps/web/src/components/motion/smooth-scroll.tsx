"use client";

import Lenis from "lenis";
import { useEffect } from "react";

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function SmoothScroll() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const touchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (reduceMotion || coarsePointer || touchDevice) {
      return;
    }

    const lenis = new Lenis({
      duration: 1.1,
      easing: easeOutExpo,
      smoothWheel: true,
      anchors: true,
      autoRaf: false,
      respectReducedMotion: true,
    });

    let frameId = 0;

    function frame(time: number) {
      lenis.raf(time);
      frameId = window.requestAnimationFrame(frame);
    }

    frameId = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(frameId);
      lenis.destroy();
    };
  }, []);

  return null;
}
