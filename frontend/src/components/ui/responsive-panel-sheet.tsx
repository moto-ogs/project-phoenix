"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Drawer, DrawerContent, DrawerTitle } from "./drawer";
import { FOCUSABLE_SELECTOR } from "./hooks/useScrollRegion";
import { SCROLL_AREA_PROPS } from "./overlay-stack";

interface ResponsivePanelSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly initialFocus?: (sheet: HTMLElement) => HTMLElement | null;
  readonly children: ReactNode;
  readonly sheetRef: RefObject<HTMLDivElement | null>;
  readonly isTopmost: () => boolean;
}

// Ein Zug im Blatt gehört nur ihm. React reicht Zeigerereignisse durch das
// Portal an Vorfahren weiter; ein Slide-over darunter würde sonst mitgezogen.
const keepPointerInSheet = (event: ReactPointerEvent) =>
  event.stopPropagation();

/** Der Telefon-Zweig von ResponsivePanel; er lädt Vaul nicht auf dem Desktop. */
export function ResponsivePanelSheet({
  open,
  onOpenChange,
  label,
  returnFocusRef,
  initialFocus,
  children,
  sheetRef,
  isTopmost,
}: ResponsivePanelSheetProps) {
  return (
    <Drawer
      open={open}
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
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
