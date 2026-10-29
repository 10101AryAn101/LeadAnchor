"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and while React hydrates, true right after. Views whose content
 * comes only from browser-side queries render their skeleton until then, so the HTML
 * the server streamed always matches what the browser renders first (no hydration
 * mismatch, even when shared data such as the session has already loaded).
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
