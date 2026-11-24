"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { APP_QUERY } from "~/lib/device-context";
import {
  BELOW_SM,
  useMediaQuery,
  useResolvedMediaQuery,
} from "~/lib/hooks/use-media-query";
import { ResponsivePanelSheet } from "./responsive-panel-sheet";

/**
 * Ob ein Panel am Auslöser gerade als Blatt erscheint: in der App (Telefon
 * und iPad, #8070), sonst als verankertes Popover. Die einzige Stelle, an der diese
 * Bedingung steht (#7797). Ein Baustein fragt sie nur ab, um sein Popover
 * (Lage am Auslöser, Schließen bei Scrollen) im Blatt abzuschalten.
 */
export function useResponsivePanelSheet(): boolean {
  const phone = useMediaQuery(BELOW_SM);
  const app = useMediaQuery(APP_QUERY);
  return phone || app;
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
  /** Stabile ID des Blatts für den Auslöser (`aria-controls`). */
  readonly sheetId?: string;
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
 * Geht es in einem offenen Blatt auf (eine Auswahlliste im Filter-Blatt),
 * wird es zum gestapelten Blatt darüber (vaul `NestedRoot`, #7800): Das
 * untere rückt nach hinten und bleibt offen. Das erkennt der Baustein selbst.
 *
 * In einem Modal oder Slide-over liegt das Blatt darüber (Ebene `popover`).
 * Escape und Tippen daneben schließen nur das Blatt, nicht das Fenster
 * darunter; dessen Fokusfalle ruht, solange das Blatt offen ist.
 */
export function ResponsivePanel({
  open,
  onOpenChange,
  label,
  sheetId,
  trigger,
  returnFocusRef,
  initialFocus,
  children,
}: ResponsivePanelProps) {
  // `null`, solange die Breite unbekannt ist (Server, Hydration).
  // In der ganzen App ein Blatt (#8070): am Telefon von unten, am iPad als
  // Karte. Der Desktop behält das Popover.
  const phoneState = useResolvedMediaQuery(BELOW_SM);
  const appState = useResolvedMediaQuery(APP_QUERY);
  const sheetState =
    phoneState === null && appState === null
      ? null
      : phoneState === true || appState === true;
  const asSheet = sheetState === true;
  const generatedSheetId = useId();
  const dialogId = sheetId ?? generatedSheetId;
  const sheetOpen = open && asSheet;

  // Wechselt die Breite über `sm` (Telefon drehen), passt die offene
  // Darstellung nicht mehr: Das Panel schließt, wie ein Popover beim
  // Ändern der Fenstergröße. Die erste bekannte Darstellung ist der
  // Ausgangswert, kein Wechsel (#8013): Nach der Hydration erfährt ein
  // Telefon erst, dass es ein Blatt zeigt, und das Panel bleibt offen.
  const shownAsSheet = useRef(sheetState);
  useEffect(() => {
    if (sheetState === null || shownAsSheet.current === sheetState) return;
    const rotated = shownAsSheet.current !== null;
    shownAsSheet.current = sheetState;
    if (rotated && open) onOpenChange(false);
  }, [sheetState, open, onOpenChange]);

  return (
    <>
      {trigger}
      {asSheet ? (
        <ResponsivePanelSheet
          id={dialogId}
          open={sheetOpen}
          onOpenChange={onOpenChange}
          label={label}
          returnFocusRef={returnFocusRef}
          initialFocus={initialFocus}
        >
          {children(true)}
        </ResponsivePanelSheet>
      ) : open ? (
        children(false)
      ) : null}
    </>
  );
}
