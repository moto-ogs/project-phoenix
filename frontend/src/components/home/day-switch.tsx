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
 * Umschalter „Heute / Morgen“ im Kopf von „Heute anders“ (#7657), im
 * Staff-Portal und in moto schule. Morgen ist der nächste Kalendertag, auch
 * am Wochenende oder an einem Schließtag.
 */
export function DaySwitch({
  value,
  onChange,
}: {
  readonly value: DayChangesDay;
  readonly onChange: (next: DayChangesDay) => void;
}) {
  return (
    <SegmentedControl<DayChangesDay>
      ariaLabel="Tag der Übersicht"
      items={[
        { value: "today", label: "Heute" },
        { value: "tomorrow", label: "Morgen" },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
