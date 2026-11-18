"use client";

import { createContext, useContext } from "react";

/**
 * True inside an open `Modal` or slide-over. A link that leads elsewhere
 * from there opens a new tab, so the dialog and its input stay (#7054,
 * rule in `jump-button.tsx`).
 */
export const InOverlayContext = createContext(false);

export function useInOverlay(): boolean {
  return useContext(InOverlayContext);
}
