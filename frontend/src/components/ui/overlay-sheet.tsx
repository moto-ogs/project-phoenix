"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useDeviceContext } from "~/lib/device-context";
import { cn } from "~/lib/utils";
import { Button } from "./button";
import { CloseIcon } from "./close-icon";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "./drawer";
import { Modal } from "./modal";
import { SCROLL_AREA_PROPS, SHEET_SCOPE_PROPS } from "./overlay-stack";

/** Höhe, in der das Blatt am Telefon aufgeht. */
export type OverlaySheetSize = "half" | "full";

/** Die beiden Rastpunkte am Telefon: halbe und volle Höhe. */
const SNAP_HALF = 0.55;
const SNAP_FULL = 1;
const SNAP_POINTS = [SNAP_HALF, SNAP_FULL];

export interface OverlaySheetProps {
  readonly open: boolean;
  /** Wischen, Esc, Tipp daneben, X oder Zurück: `false`. */
  readonly onOpenChange: (open: boolean) => void;
  /** Sichtbarer Titel und Name des Dialogs. */
  readonly title: string;
  /** Eine Zeile unter dem Titel, nur wenn sie eine Entscheidung trägt. */
  readonly description?: ReactNode;
  /** Telefon: Start in halber (Standard) oder voller Höhe. */
  readonly size?: OverlaySheetSize;
  /** Steht unten fest (Hauptaktion des Blatts). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** Text des X für Vorleseprogramme. */
  readonly closeLabel?: string;
}

/**
 * Das eine Blatt der App (#8070): am Telefon von unten auf Vaul mit Griff und
 * zwei Rastpunkten (halbe und volle Höhe), am iPad (hoch und quer) als
 * schwebende Karte unten in der Mitte, auf dem Desktop das gewohnte mittige
 * Fenster (`Modal`).
 *
 * In der App ist das Blatt ein Schritt im Verlauf: Zurück schließt es, und
 * es ist immer nur eins offen. Ein zweites Blatt ersetzt das erste; eines,
 * das in diesem aufgeht, verdeckt es, bis Zurück es wieder zeigt
 * (`sheet-session.ts`). Es schließt außerdem per Wischen, Esc und Tipp auf
 * die Abdunklung.
 *
 * ```tsx
 * <OverlaySheet open={open} onOpenChange={setOpen} title="Filter">
 *   …
 * </OverlaySheet>
 * ```
 */
export function OverlaySheet(props: OverlaySheetProps) {
  const { resolved, isApp } = useDeviceContext();
  // Vor der Hydration ist das Gerät unbekannt; ein Blatt geht ohnehin erst
  // auf eine Handlung hin auf. Der Desktop-Zweig ist der Standard.
  if (resolved && isApp) return <AppSheet {...props} />;
  return <DesktopSheet {...props} />;
}

function DesktopSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  closeLabel,
}: OverlaySheetProps) {
  return (
    <Modal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={title}
      description={typeof description === "string" ? description : undefined}
      footer={footer}
      closeLabel={closeLabel}
    >
      {typeof description === "string" ? null : description}
      {children}
    </Modal>
  );
}

function AppSheet({
  open,
  onOpenChange,
  title,
  description,
  size = "half",
  footer,
  children,
  closeLabel = "Blatt schließen",
}: OverlaySheetProps) {
  const { layout } = useDeviceContext();
  const phone = layout === "phone";
  const startSnap = size === "full" ? SNAP_FULL : SNAP_HALF;
  const [snap, setSnap] = useState<number | string | null>(startSnap);
  // Jedes Öffnen beginnt in der gewählten Höhe.
  useEffect(() => {
    if (open) setSnap(startSnap);
  }, [open, startSnap]);

  const snapProps = phone
    ? {
        snapPoints: SNAP_POINTS,
        activeSnapPoint: snap,
        setActiveSnapPoint: setSnap,
        fadeFromIndex: 0,
      }
    : {};

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
      {...snapProps}
    >
      <DrawerContent
        {...SHEET_SCOPE_PROPS}
        data-overlay-sheet=""
        aria-describedby={undefined}
        className={cn(
          "pb-[env(safe-area-inset-bottom)]",
          // Am Telefon trägt das Blatt die volle Höhe; Vaul schiebt es auf
          // den Rastpunkt. Oben bleibt die Statusleiste frei.
          phone &&
            "h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] max-h-none",
        )}
        // In halber Höhe liegt der untere Teil des Blatts außerhalb des
        // Bildes; das Polster hebt Fußzeile und Listenende darüber.
        style={
          phone && snap === SNAP_HALF
            ? {
                paddingBottom: `calc(100dvh - env(safe-area-inset-top) - 0.5rem - ${SNAP_HALF * 100}dvh)`,
              }
            : undefined
        }
      >
        <div className="flex items-start gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <DrawerTitle className="truncate text-base leading-6">
              {title}
            </DrawerTitle>
            {description ? (
              <DrawerDescription className="mt-0.5">
                {description}
              </DrawerDescription>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            tooltip="Schließt das Blatt."
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </Button>
        </div>
        <div
          {...SCROLL_AREA_PROPS}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 gap-3 border-t border-gray-100 px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
