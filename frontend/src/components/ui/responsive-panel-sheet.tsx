"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "./button";
import { CloseIcon } from "./close-icon";
import { Drawer, DrawerContent, DrawerNested, DrawerTitle } from "./drawer";
import { FOCUSABLE_SELECTOR } from "./hooks/useScrollRegion";
import {
  SCROLL_AREA_PROPS,
  SHEET_SCOPE_PROPS,
  useOverlay,
} from "./overlay-stack";

export interface ResponsivePanelSheetProps {
  readonly id: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly initialFocus?: (sheet: HTMLElement) => HTMLElement | null;
  readonly children: ReactNode;
}

// Ein Zug im Blatt gehört nur ihm. React reicht Zeigerereignisse durch das
// Portal an Vorfahren weiter; ein Slide-over darunter würde sonst mitgezogen.
const keepPointerInSheet = (event: ReactPointerEvent) =>
  event.stopPropagation();

/**
 * Das offene Blatt, in dem ein weiteres `ResponsivePanel` aufgeht. Darüber
 * erkennt das innere Blatt selbst, dass es gestapelt ist (#7800), ohne Prop.
 */
interface ParentSheet {
  /** Rückt das untere Blatt nach hinten, solange ein Blatt darüber offen ist. */
  readonly setCovered: (covered: boolean) => void;
}

const ParentSheetContext = createContext<ParentSheet | null>(null);

// Vauls Werte für ein Blatt unter einem anderen (TRANSITIONS und
// NESTED_DISPLACEMENT in vaul), damit sein Ziehen nahtlos daran anschließt.
const SHEET_TRANSITION = "transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)";
const NESTED_DISPLACEMENT_PX = 16;

/** Der Telefon-Zweig von ResponsivePanel. */
export function ResponsivePanelSheet({
  id,
  open,
  onOpenChange,
  label,
  returnFocusRef,
  initialFocus,
  children,
}: ResponsivePanelSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Die Abdunklung gehört zum Blatt: Ein Tipp darauf schließt nur das Blatt,
  // nicht auch den Kalender oder das Popover, aus dem es aufging.
  const surfaces = useMemo(() => [sheetRef, overlayRef], []);
  const parent = useContext(ParentSheetContext);
  // In einem offenen Blatt: ein zweites Blatt darüber (vaul `NestedRoot`).
  const Root = parent === null ? Drawer : DrawerNested;

  // Vaul rückt das untere Blatt nur nach hinten und wieder vor, wenn es das
  // obere selbst öffnet oder schließt, nicht bei gesteuertem `open`: Öffnen
  // per Auslöser und Schließen per Eintrag gingen sonst ohne Stapel-Optik.
  // Das Ziehen am oberen Blatt bewegt das untere weiter über vaul.
  useEffect(() => {
    if (parent === null || !open) return undefined;
    parent.setCovered(true);
    return () => parent.setCovered(false);
  }, [open, parent]);

  const setCovered = useCallback((covered: boolean) => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    const scale =
      (window.innerWidth - NESTED_DISPLACEMENT_PX) / window.innerWidth;
    sheet.style.transition = SHEET_TRANSITION;
    sheet.style.transform = covered
      ? `scale(${scale}) translate3d(0, -${NESTED_DISPLACEMENT_PX}px, 0)`
      : "";
  }, []);
  const ownSheet = useMemo<ParentSheet>(() => ({ setCovered }), [setCovered]);
  // Auf dem Stapel der Overlays: Ein Popover, das im Blatt aufgeht, gehört
  // zu ihm, und ein Dialog darüber verdrängt es wie jedes Popover.
  const { isTopmost } = useOverlay(open, "popover", {
    elementRef: surfaces,
    onCovered: () => onOpenChange(false),
  });

  return (
    <Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        id={id}
        ref={sheetRef}
        overlayRef={overlayRef}
        layer="popover"
        // Vauls Fokusfalle wie im Slide-over: Kalender und Popover im Blatt
        // erkennen sie daran und bleiben per Tastatur erreichbar.
        {...SHEET_SCOPE_PROPS}
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
          // Der erste Eintrag im Inhalt, nicht das X im Kopf.
          const target =
            initialFocus?.(sheet) ??
            bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
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
        {/* Jedes Blatt der App hat ein X (#8070). */}
        <div className="flex items-center gap-3 pr-2 pl-4">
          <DrawerTitle className="min-w-0 flex-1 truncate text-base leading-6">
            {label}
          </DrawerTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Blatt schließen"
            tooltip="Schließt das Blatt."
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </Button>
        </div>
        {/* Eine klebende Fußleiste schließt bündig unten ab: Darunter läuft
            kein Inhalt mehr durch. */}
        <div
          ref={bodyRef}
          {...SCROLL_AREA_PROPS}
          className="min-h-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-4 has-[.sticky.bottom-0]:pb-0"
        >
          <ParentSheetContext.Provider value={ownSheet}>
            {children}
          </ParentSheetContext.Provider>
        </div>
      </DrawerContent>
    </Root>
  );
}
