"use client";

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = false) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Phones and small tablets get bottom sheets and column paging instead of drag and drop. */
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
