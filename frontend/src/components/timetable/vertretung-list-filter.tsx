"use client";

import { SegmentedControl } from "~/components/ui/segmented-control";

/**
 * Anzeigemodus der Störungslisten. Der Typ wohnt HIER und nicht in
 * vertretung-day-list.tsx: die Liste rendert den Filter, ein Typ-Import in die
 * Gegenrichtung wäre ein Import-Zyklus (depcruise no-circular). Die Liste
 * exportiert ihn unter ihrem angestammten Namen weiter, damit die Aufrufer
 * unverändert bleiben.
 */
export type VertretungDayListMode = "stoerungen" | "ganzer-tag";

/**
 * Der Filter "Nur Störungen | Ganzer Tag" als Kopfzeile DER Liste, die er
 * filtert (#2031). Vorher stand er in der Kopfleiste der Seite, optisch
 * identisch mit dem Ansichts-Umschalter "Tag | Woche" direkt darüber: zwei
 * gleich aussehende Pillenleisten mit völlig verschiedener Wirkung. Jetzt sitzt
 * er im Kopf der Karte, die er verändert, neben ihrer Überschrift (#7493).
 */
interface VertretungListFilterProps {
  readonly mode: VertretungDayListMode;
  readonly onModeChange: (mode: VertretungDayListMode) => void;
  /** Beschriftung der Alles-Option: "Ganzer Tag" bzw. "Ganze Woche". */
  readonly allLabel: string;
}

export function VertretungListFilter({
  mode,
  onModeChange,
  allLabel,
}: VertretungListFilterProps) {
  return (
    // Sitzt im Kopf der Karte, die er filtert (`SectionCard` `action`): das
    // Polster kommt von dort.
    <SegmentedControl
      ariaLabel="Liste filtern"
      value={mode}
      onChange={(next) => onModeChange(next as VertretungDayListMode)}
      items={[
        { value: "stoerungen", label: "Nur Störungen" },
        { value: "ganzer-tag", label: allLabel },
      ]}
    />
  );
}
