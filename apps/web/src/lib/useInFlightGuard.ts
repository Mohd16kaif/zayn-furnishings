"use client";

import { useCallback, useRef } from "react";

/**
 * Synchronous guard for a submit button. React state updates are async, so two
 * very fast clicks can reach a handler before `disabled` rerenders.
 */
export function useInFlightGuard() {
  const inFlight = useRef(false);

  const begin = useCallback(() => {
    if (inFlight.current) {
      return false;
    }

    inFlight.current = true;
    return true;
  }, []);

  const end = useCallback(() => {
    inFlight.current = false;
  }, []);

  return { begin, end };
}
