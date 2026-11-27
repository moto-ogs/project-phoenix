import { useCallback, useMemo, useState } from "react";

import {
  staffShiftSeriesService,
  type SeriesResult,
  type SeriesRule,
} from "~/lib/shift-api";
import type { StaffShift } from "~/lib/shift-helpers";
import { useDraftOn, useReadDraft, type ReadDraft } from "~/lib/swr/read-draft";
import { staffTimeKeys } from "~/lib/swr/staff-keys";
import { parseISODate, toISODate } from "~/lib/date-helpers";

/** One replacement (Vertretung) covering a cancelled shift. Several rows split
 *  a single gap across people (#1841). breakMinutes/shiftTypeId are carried
 *  per row (not editable in this modal) so re-saving the origin preserves each
 *  cover's own values instead of clobbering them with 0 / the origin's type. */
export interface ReplacementRow {
  readonly staffId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly shiftTypeId: string;
}

/** The fields both editors show: the day's and the series rule's. */
export interface TimeFields {
  readonly startTime: string;
  readonly endTime: string;
  /** Raw so the field can be cleared while typing; parsed on submit. */
  readonly breakMinutesStr: string;
  /** "" = no shift type. */
  readonly shiftTypeId: string;
}

/** The day's draft: one shift, its cancellation and its covers. */
export interface ShiftFields extends TimeFields {
  readonly changeReason: string;
  readonly cancelled: boolean;
  readonly replacements: readonly ReplacementRow[];
}

/** The series editor's draft, as one rule fills it. */
export interface SeriesEditorFields extends TimeFields {
  readonly weekdays: readonly number[];
  readonly biweekly: boolean;
  readonly abPattern: 1 | 2;
  /** Inclusive, as the picker shows it. */
  readonly validUntil: string;
  readonly includeSchoolBreaks: boolean;
}

/** The stored shift and the covers of its gap (#1841). */
export interface StoredShift {
  readonly shift: StaffShift;
  readonly covers: readonly StaffShift[];
}

/** The versions a save of the day confirms (ADR 0311). */
export interface ShiftToken {
  readonly version: string;
  readonly covers: readonly (readonly [string, string])[];
}

/** What the day's draft rests on: a stored shift, or none when creating. */
interface ShiftOpening {
  readonly stored: StoredShift | null;
  readonly fields: ShiftFields;
}

function seriesEditorFields(rule: SeriesRule): SeriesEditorFields {
  return {
    weekdays: [...rule.weekdays].sort((a, b) => a - b),
    biweekly: rule.weekPattern !== 0,
    abPattern: rule.weekPattern === 2 ? 2 : 1,
    // Stored valid_until is exclusive, the picker inclusive.
    validUntil: rule.validUntil ? dayBeforeISO(rule.validUntil) : "",
    includeSchoolBreaks: rule.includeSchoolBreaks,
    startTime: rule.startTime,
    endTime: rule.endTime,
    breakMinutesStr: String(rule.breakMinutes),
    shiftTypeId: rule.shiftTypeId ?? "",
  };
}

function storedFields({ shift, covers }: StoredShift): ShiftFields {
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutesStr: String(shift.breakMinutes),
    shiftTypeId: shift.shiftTypeId ?? "",
    changeReason: shift.changeReason ?? "",
    cancelled: shift.cancelled ?? false,
    // The covers already attached to the shift: reopening a cancelled shift
    // keeps them; saving would otherwise send an empty set and the backend
    // would delete every existing cover (#1841).
    replacements: covers.map((cover) => ({
      staffId: cover.staffId,
      startTime: cover.startTime,
      endTime: cover.endTime,
      breakMinutes: cover.breakMinutes,
      shiftTypeId: cover.shiftTypeId ?? "",
    })),
  };
}

function shiftToken(read: ShiftOpening): ShiftToken | null {
  if (read.stored === null) return null;
  return {
    version: read.stored.shift.version ?? "",
    covers: read.stored.covers.map((cover) => [cover.id, cover.version ?? ""]),
  };
}

const toFields = (read: ShiftOpening) => read.fields;

/** The day as saved: the dialog closes after it (see `answer` below). */
const keepBase = (_saved: unknown, base: ShiftOpening) => base;

function sameSeriesEditorFields(
  a: SeriesEditorFields,
  b: SeriesEditorFields,
): boolean {
  return (
    a.weekdays.length === b.weekdays.length &&
    a.weekdays.every((day, i) => day === b.weekdays[i]) &&
    a.biweekly === b.biweekly &&
    a.abPattern === b.abPattern &&
    a.validUntil === b.validUntil &&
    a.includeSchoolBreaks === b.includeSchoolBreaks &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.breakMinutesStr === b.breakMinutesStr &&
    a.shiftTypeId === b.shiftTypeId
  );
}

/**
 * The drafts of the shift dialog (ADR 0311): the day, on the stored shift
 * the dialog opened with, and the series editor, on the rule behind it.
 * Each keeps the token of the moment editing started; a refusal shows the
 * stored state and sending waits for its read.
 *
 * The day's fields (times, break, type) are shown by the series editor
 * while it is open: `fields` and `setFields` edit the draft on screen, so
 * returning from the editor brings back the day's own draft.
 */
export function useShiftEditDraft({
  opening,
  stored,
  seed,
  reloadShift,
}: {
  /** Identifies the stored shift or the new shift being edited. */
  readonly opening: string;
  /** The stored shift being edited; null when creating. */
  readonly stored: StoredShift | null;
  /** The fields a new shift starts with. */
  readonly seed: ShiftFields;
  /**
   * Reads the stored shift again after a refusal; the dialog's props carry
   * it too. Its answer lets the draft settle on an unchanged shift.
   */
  readonly reloadShift: () => Promise<StoredShift | undefined | void>;
}): {
  readonly day: ReadDraft<
    ShiftOpening,
    ShiftFields,
    ShiftToken | null,
    unknown
  >;
  readonly series: ReadDraft<
    SeriesRule,
    SeriesEditorFields,
    string,
    SeriesResult
  >;
  readonly seriesEditOpen: boolean;
  readonly openSeriesEdit: () => void;
  /** Back to the day: the series editor's input goes. */
  readonly leaveSeriesEdit: () => void;
  readonly fields: TimeFields;
  readonly setFields: (patch: Partial<TimeFields>) => void;
} {
  const read = useMemo<ShiftOpening>(
    () => ({
      stored,
      fields: stored ? storedFields(stored) : seed,
    }),
    [stored, seed],
  );
  const day = useDraftOn<ShiftOpening, ShiftFields, ShiftToken | null>(
    {
      opening,
      data: read,
      reload: async () => {
        const again = await reloadShift();
        // Without an answer the stored shift arrives through the props.
        return again
          ? { stored: again, fields: storedFields(again) }
          : undefined;
      },
    },
    {
      token: shiftToken,
      toDraft: toFields,
      // Every save of the day closes the dialog, and `onSaved` reloads the
      // plan: nothing edits this draft after it, so no read of the saved
      // shift.
      answer: keepBase,
    },
  );

  // The rule behind a series shift (#2028), loaded on opening so the dialog
  // states the rhythm up front. Every series write sends the version of the
  // rule on screen: the day's split confirms the rule shown when the dialog
  // opened (`follow` off), an untouched editor follows a newer read, a
  // touched one keeps the rule it opened from.
  const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const seriesId = stored?.shift.seriesId ?? null;
  const series = useReadDraft<
    SeriesRule,
    SeriesEditorFields,
    string,
    SeriesResult
  >({
    key: seriesId !== null ? staffTimeKeys.shiftSeries(seriesId) : null,
    fetcher: () => staffShiftSeriesService.getSeries(seriesId ?? ""),
    token: (rule) => rule.version,
    toDraft: seriesEditorFields,
    same: sameSeriesEditorFields,
    follow: seriesEditOpen,
  });

  const { discard: discardSeries, setDraft: setSeriesDraft } = series;
  const { setDraft: setDayDraft } = day;
  const leaveSeriesEdit = useCallback(() => {
    discardSeries();
    setSeriesEditOpen(false);
  }, [discardSeries]);
  const openSeriesEdit = useCallback(() => setSeriesEditOpen(true), []);
  const editingSeries = seriesEditOpen && series.draft !== undefined;
  const setFields = useCallback(
    (patch: Partial<TimeFields>) => {
      if (editingSeries) setSeriesDraft((draft) => ({ ...draft, ...patch }));
      else setDayDraft((draft) => ({ ...draft, ...patch }));
    },
    [editingSeries, setSeriesDraft, setDayDraft],
  );

  return {
    day,
    series,
    seriesEditOpen,
    openSeriesEdit,
    leaveSeriesEdit,
    fields: (editingSeries ? series.draft : day.draft) ?? read.fields,
    setFields,
  };
}

/** The stored exclusive valid_until as the inclusive "Gültig bis" the
 *  picker and the summary line show. */
export function dayBeforeISO(isoDate: string): string {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() - 1);
  return toISODate(d);
}
