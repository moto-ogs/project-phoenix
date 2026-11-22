"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { Drawer, DrawerContent, DrawerTitle } from "./drawer";
import { FOCUSABLE_SELECTOR } from "./hooks/useScrollRegion";
import { SCROLL_AREA_PROPS, useOverlay } from "./overlay-stack";

/**
 * Ob ein Panel am Auslöser gerade als Blatt von unten erscheint: unter `sm`
 * (Telefon), sonst als verankertes Popover. Die einzige Stelle, an der diese
 * Bedingung steht (#7797). Ein Baustein fragt sie nur ab, um sein Popover
 * (Lage am Auslöser, Schließen bei Scrollen) im Blatt abzuschalten.
 */
export function useResponsivePanelSheet(): boolean {
  return useMediaQuery(BELOW_SM);
}

interface ResponsivePanelProps {
  /** Ob das Panel offen ist. Der Aufrufer hält den Zustand. */
  readonly open: boolean;
  /**
   * Das Blatt will schließen: Wischen nach unten, Tippen auf die Abdunklung,
   * Escape, oder die Breite wechselt über `sm`.
   */
  readonly onOpenChange: (open: boolean) => void;
  /** Name des Blatts als Dialog für Vorleseprogramme. */
  readonly label: string;
  /** Der Auslöser; er steht auf jeder Breite gleich da. */
  readonly trigger: ReactNode;
  /** Bekommt den Fokus zurück, wenn das Blatt schließt. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  /**
   * Was im Blatt beim Öffnen den Fokus bekommt, etwa der gewählte Eintrag.
   * Ohne Angabe oder ohne Treffer das erste bedienbare Element.
   */
  readonly initialFocus?: (sheet: HTMLElement) => HTMLElement | null;
  /**
   * Der Inhalt. `asSheet` sagt, wo er steht: im Blatt (ohne eigene Fläche)
   * oder als Popover, das der Baustein wie bisher selbst am Auslöser
   * verankert. Er behält seine Rolle (Menü, Liste, Kalender).
   */
  readonly children: (asSheet: boolean) => ReactNode;
}

// Ein Zug im Blatt gehört nur ihm. React reicht Zeigerereignisse durch das
// Portal an Vorfahren weiter; ein Slide-over darunter würde sonst mitgezogen.
const keepPointerInSheet = (event: ReactPointerEvent) =>
  event.stopPropagation();

/**
 * Popover oder Blatt (ADR 0149, #7797): ab `sm` rendert der Baustein das
 * verankerte Popover seines Aufrufers, darunter ein Blatt von unten auf dem
 * Drawer, wie „Mehr“ in der unteren Leiste.
 *
 * Das Blatt ist ein Dialog. Es schließt durch Wischen nach unten, Tippen auf
 * die Abdunklung und Escape. Beim Öffnen liegt der Fokus auf dem ersten
 * Eintrag (oder `initialFocus`), beim Schließen kehrt er zum Auslöser zurück,
 * außer ein Dialog, den ein Eintrag geöffnet hat, hält ihn schon.
 *
 * In einem Modal oder Slide-over liegt das Blatt darüber (Ebene `popover`).
 * Escape und Tippen daneben schließen nur das Blatt, nicht das Fenster
 * darunter; dessen Fokusfalle ruht, solange das Blatt offen ist.
 */
export function ResponsivePanel({
  open,
  onOpenChange,
  label,
  trigger,
  returnFocusRef,
  initialFocus,
  children,
}: ResponsivePanelProps) {
  const asSheet = useResponsivePanelSheet();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetOpen = open && asSheet;
  // Auf dem Stapel der Overlays: Ein Popover, das im Blatt aufgeht, gehört
  // zu ihm, und ein Dialog darüber verdrängt es wie jedes Popover.
  const { isTopmost } = useOverlay(sheetOpen, "popover", {
    elementRef: sheetRef,
    onCovered: () => onOpenChange(false),
  });

  // Wechselt die Breite über `sm` (Telefon drehen), passt die offene
  // Darstellung nicht mehr: Das Panel schließt, wie ein Popover beim
  // Ändern der Fenstergröße.
  const shownAsSheet = useRef(asSheet);
  useEffect(() => {
    if (shownAsSheet.current === asSheet) return;
    shownAsSheet.current = asSheet;
    if (open) onOpenChange(false);
  }, [asSheet, open, onOpenChange]);

  return (
    <>
      {trigger}
      {asSheet ? (
        <Drawer
          open={sheetOpen}
          onOpenChange={onOpenChange}
          shouldScaleBackground={false}
        >
          <DrawerContent
            ref={sheetRef}
            layer="popover"
            // Name aus dem Titel, keine Beschreibung.
            aria-describedby={undefined}
            className="pb-[env(safe-area-inset-bottom)]"
            onPointerDown={keepPointerInSheet}
            onPointerMove={keepPointerInSheet}
            onPointerUp={keepPointerInSheet}
            onOpenAutoFocus={(event: Event) => {
              event.preventDefault();
              const sheet = sheetRef.current;
              if (sheet === null) return;
              const target =
                initialFocus?.(sheet) ??
                sheet.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
              (target ?? sheet).focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event: Event) => {
              // Ohne Radix-Auslöser gäbe Radix den Fokus nirgends zurück.
              event.preventDefault();
              const active = document.activeElement;
              const focusLost =
                active === null ||
                active === document.body ||
                sheetRef.current?.contains(active) === true;
              if (focusLost) returnFocusRef.current?.focus();
            }}
            onEscapeKeyDown={(event: KeyboardEvent) => {
              // Liegt etwas über dem Blatt, nimmt das die Taste.
              if (!isTopmost()) {
                event.preventDefault();
                return;
              }
              // Radix hört in der Capture-Phase am Dokument. Ohne diesen Halt
              // schlösse ein Modal darunter mit derselben Taste.
              event.stopPropagation();
            }}
          >
            <DrawerTitle className="sr-only">{label}</DrawerTitle>
            <div
              {...SCROLL_AREA_PROPS}
              className="min-h-0 overflow-y-auto overscroll-contain px-2 pt-2 pb-4"
            >
              {children(true)}
            </div>
          </DrawerContent>
        </Drawer>
      ) : open ? (
        children(false)
      ) : null}
    </>
  );
}
