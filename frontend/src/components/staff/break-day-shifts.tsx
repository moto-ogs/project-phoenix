"use client";

import { useId, useMemo, useState } from "react";
import { CalendarX2, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import { useSwrLoadError as useLoadError } from "~/lib/hooks/use-swr-load-error";
import { staffShiftService } from "~/lib/shift-api";
import { useSWRAuth } from "~/lib/swr";
import { timetableKeys } from "~/lib/swr/portal-keys";
import { BREAK_DAY_LABEL, type BreakDayShift } from "~/lib/shift-helpers";

/**
 * Lädt die Schichten an Schließtagen einmal für Karte und Raster (#8205).
 * `byShiftId` trägt die Warnung an die Schicht.
 */
export function useBreakDayShifts(enabled: boolean) {
  const { data, error, mutate } = useSWRAuth(
    enabled ? timetableKeys.breakDayShifts : null,
    () => staffShiftService.listBreakDayShifts(),
  );
  const loadError = useLoadError(error, "die Schichten an Schließtagen", () =>
    mutate(),
  );
  const byShiftId = useMemo(
    () =>
      new Map<string, BreakDayShift["kind"]>(
        (data ?? []).map((row) => [row.shiftId, row.kind]),
      ),
    [data],
  );
  return { shifts: data, loadError, byShiftId };
}

/** Offene Zeilen vor „N weitere anzeigen“, wie in den anderen Hinweislisten. */
const INITIAL_ROW_COUNT = 5;

interface BreakDayPerson {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Schichten an Schließtagen (#8205): Schichten aus Serien, die Ferien und
 * Schließtage auslassen, die trotzdem an so einem Tag stehen. Einen später
 * eingetragenen Schließtag der Schule sagt moto bei unveränderten
 * Serienschichten selbst ab. Hier bleiben die von Hand geänderten Schichten,
 * über die die Leitung selbst entscheidet, und die, die moto nicht absagen
 * konnte (Schließtag des Trägers, Ferien). Muster „mehrere Hinweise
 * derselben Art“ (frontend-ui-kit): eine Karte, Zeilen mit „Woche ansehen“.
 */
export function BreakDayShifts({
  shifts,
  loadError,
  staffById,
  onShowWeek,
}: Readonly<{
  shifts: readonly BreakDayShift[] | undefined;
  /** Der Ladefehler aus `useSwrLoadError`. */
  loadError: ReturnType<typeof useLoadError>;
  /** Namen aus der Personalliste des Dienstplans; die Zeilen tragen Ids. */
  staffById: ReadonlyMap<string, BreakDayPerson>;
  /** Zeigt die Woche des Tages im Dienstplan. */
  onShowWeek: (day: string) => void;
}>) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () =>
      [...(shifts ?? [])].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime) ||
          a.shiftId.localeCompare(b.shiftId),
      ),
    [shifts],
  );

  if (loadError) {
    return <LoadErrorAlert error={loadError} actionLayout="responsive" />;
  }
  if (rows.length === 0) return null;

  const nameOf = (row: BreakDayShift) => {
    const person = staffById.get(row.staffId);
    return person ? `${person.firstName} ${person.lastName}` : "Unbekannt";
  };
  const hiddenCount = Math.max(0, rows.length - INITIAL_ROW_COUNT);
  const visible = expanded ? rows : rows.slice(0, INITIAL_ROW_COUNT);

  return (
    <SectionCard
      testId="break-day-shifts"
      title="Schichten an Schließtagen"
      titleBadge={<StatusBadge tone="warning" label={`${rows.length} offen`} />}
      description="Diese Schichten stehen an einem Schließtag oder in den Ferien. Ihre Serie plant an solchen Tagen sonst nicht."
      leading={
        <CalendarX2
          className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
      }
    >
      {/* Einmal über der Liste: gilt für jede Zeile. */}
      <p className="mb-3 max-w-2xl text-sm text-gray-600">
        Unveränderte Schichten sagt moto ab, wenn die Schule einen Schließtag
        einträgt. Von Hand geänderte Schichten bleiben stehen. Prüfe sie und sag
        sie ab, wenn an dem Tag niemand arbeiten soll.
      </p>
      <ResponsiveActionList id={listId}>
        {visible.map((row) => {
          const name = nameOf(row);
          return (
            <ResponsiveActionRow key={row.shiftId}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{name}</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {formatDate(row.date, true)} · {row.startTime}–{row.endTime} ·{" "}
                  {BREAK_DAY_LABEL[row.kind]} ·{" "}
                  {row.adjusted ? "von Hand geändert" : "noch nicht abgesagt"}
                </p>
              </div>
              <ResponsiveRowActions>
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  aria-label={`Woche der Schicht von ${name} ansehen`}
                  tooltip="Zeigt die Woche der Schicht im Dienstplan."
                  onClick={() => onShowWeek(row.date)}
                >
                  Woche ansehen
                </Button>
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          );
        })}
      </ResponsiveActionList>
      {hiddenCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="mt-2 w-full"
          noTooltip="Klappt nur die Liste auf oder zu."
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <>
              Weniger anzeigen
              <ChevronUp className="size-4" aria-hidden="true" />
            </>
          ) : (
            <>
              {hiddenCount} weitere anzeigen
              <ChevronDown className="size-4" aria-hidden="true" />
            </>
          )}
        </Button>
      ) : null}
    </SectionCard>
  );
}
