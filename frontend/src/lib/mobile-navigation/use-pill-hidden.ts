"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useDeviceContext } from "~/lib/device-context";
import {
  useTenantRoutingModeSafe,
  useTenantSlugSafe,
} from "~/lib/tenant-context";
import { normalizeTenantPathname } from "~/lib/tenant-path";
import { hidesPill } from "./tab-registry";

/**
 * Auf `<html>`, solange die App ohne Pill läuft. `globals.css` gibt `<main>`
 * dann nur noch die Safe Area als Abstand unten statt der Fläche der Pill;
 * `useChatViewportLock` liest diesen Abstand und lässt das Schreibfeld unten
 * kleben.
 */
export const PILL_HIDDEN_ATTRIBUTE = "data-pill-hidden";

/**
 * Ob die Pill auf der aktuellen Seite ausgeblendet ist (Register
 * `hidesPill`). Nur in der App; der Desktop hat keine Pill.
 */
export function usePillHidden(): boolean {
  const rawPathname = usePathname();
  const tenantSlug = useTenantSlugSafe();
  const routingMode = useTenantRoutingModeSafe();
  const { isApp, isSplit } = useDeviceContext();
  const pathname = normalizeTenantPathname(
    rawPathname,
    tenantSlug,
    routingMode,
  );
  const hidden = isApp && hidesPill(pathname, { split: isSplit });

  useEffect(() => {
    if (!hidden) return;
    const html = document.documentElement;
    html.setAttribute(PILL_HIDDEN_ATTRIBUTE, "");
    return () => html.removeAttribute(PILL_HIDDEN_ATTRIBUTE);
  }, [hidden]);

  return hidden;
}
