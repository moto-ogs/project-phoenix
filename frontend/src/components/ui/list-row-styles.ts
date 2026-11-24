import { cn } from "~/lib/utils";

export type ListRowTone =
  "neutral" | "success" | "danger" | "muted" | "surface";
export type ListRowDensity = "default" | "compact";

const TONE_CLASSES: Record<ListRowTone, string> = {
  neutral: "bg-gray-50/50",
  success: "bg-moto-green/10",
  danger: "bg-moto-red/5",
  muted: "bg-gray-100",
  // Für Zeilen auf einer grauen Innenfläche, auf der `neutral` verschwände.
  surface: "bg-white shadow-sm",
};

const TONE_HOVER_CLASSES: Record<ListRowTone, string> = {
  neutral: "hover:bg-gray-100/50",
  success: "hover:bg-moto-green/15",
  danger: "hover:bg-moto-red/10",
  muted: "hover:bg-gray-200/60",
  surface: "hover:bg-gray-50",
};

/**
 * Die Hover-Farbe von `neutral`, wenn die Zeile in einem Link (`group`) liegt
 * und dessen Überfahren sie färbt (Zeile der `StatCard`). Steht neben
 * `TONE_HOVER_CLASSES`, damit beide gemeinsam wandern.
 */
export const LIST_ROW_NEUTRAL_GROUP_HOVER =
  "transition-colors group-hover:bg-gray-100/50";

const DENSITY_CLASSES: Record<ListRowDensity, string> = {
  default: "px-3 py-2",
  // Für Karten fester Höhe: ab `sm` passen so drei Zeilen ganz hinein. Der
  // Desktop-Wert steht unvariiert, das Telefon (`max-sm:`) behält seine 8 px
  // (Stufenmodell, TENANT-PAGE-SPEC.md). `compact:` braucht keinen eigenen
  // Wert: die Zeile ist dort so dicht wie am Desktop.
  compact: "px-3 py-1.5 max-sm:py-2",
};

/**
 * Rückmeldung beim Antippen einer Zeile (#7794): per Finger tönt sie grau,
 * der graue iOS-Blitz bleibt aus. Mit Maus ändert sich nichts.
 */
export const ROW_TAP_FEEDBACK =
  "[-webkit-tap-highlight-color:transparent] pointer-coarse:active:bg-gray-200/70";

/** Fläche einer Listenzeile, geteilt von `ListRow` und `ListRowSkeleton`. */
export function listRowClasses({
  tone = "neutral",
  density = "default",
  interactive = false,
}: Readonly<{
  tone?: ListRowTone;
  density?: ListRowDensity;
  interactive?: boolean;
}> = {}): string {
  return cn(
    "flex items-center justify-between gap-3 rounded-xl",
    DENSITY_CLASSES[density],
    TONE_CLASSES[tone],
    interactive &&
      `w-full text-left transition-colors focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:outline-none focus-visible:ring-inset ${TONE_HOVER_CLASSES[tone]} ${ROW_TAP_FEEDBACK}`,
  );
}

/**
 * Hinterlegung einer `ListRowLink`-Zeile in einer Liste: die offene Auswahl
 * grün (wie in der Datenverwaltung), sonst nur beim Überfahren grau.
 */
export function listRowLinkStateClasses(selected: boolean): string {
  return selected
    ? "bg-moto-green-soft/60 hover:bg-moto-green-soft/70 active:bg-moto-green-soft/70"
    : `hover:bg-gray-50 active:bg-gray-100 ${ROW_TAP_FEEDBACK}`;
}
