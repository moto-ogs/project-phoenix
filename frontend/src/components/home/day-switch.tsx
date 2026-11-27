"use client";

import type { DayChangesDay } from "~/components/home/day-changes-text";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { parseISODate, toISODate } from "~/lib/date-helpers";

/** Der Kalendertag nach `iso` („2026-11-26“ → „2026-11-27“). */
export function nextDayISO(iso: string): string {
  const next = parseISODate(iso);
  next.setDate(next.getDate() + 1);
  return toISODate(next);
}

/**
 * Ob eine Übersicht zum gewählten Tag gehört. SWR zeigt beim Wechsel die
 * Daten des anderen Tags weiter, bis die neuen da sind (`keepPreviousData`);
 * die stünden dann mit den Sätzen des falschen Tags da.
 */
export function isOverviewOfDay(
  overview: { readonly date: string } | undefined,
  selectedDate: string,
): boolean {
  return overview?.date === selectedDate;
}

/** Die Beschriftung des Umschalters; das Elternportal übersetzt sie (#8236). */
export interface DaySwitchLabels {
  readonly label: string;
  readonly today: string;
  readonly tomorrow: string;
}

const GERMAN_LABELS: DaySwitchLabels = {
  label: "Tag der Übersicht",
  today: "Heute",
  tomorrow: "Morgen",
};

/**
 * Umschalter „Heute / Morgen“ im Kopf von „Heute anders“ (#7657), im
 * Staff-Portal, in moto schule, im Eltern- und im Träger-Portal (#8236).
 * Morgen ist der nächste Kalendertag, auch am Wochenende oder an einem
 * Schließtag.
 */
export function DaySwitch({
  value,
  onChange,
  labels = GERMAN_LABELS,
}: {
  readonly value: DayChangesDay;
  readonly onChange: (next: DayChangesDay) => void;
  readonly labels?: DaySwitchLabels;
}) {
  return (
    <SegmentedControl<DayChangesDay>
      ariaLabel={labels.label}
      items={[
        { value: "today", label: labels.today },
        { value: "tomorrow", label: labels.tomorrow },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
