"use client";

/**
 * Lädt zum Entwurf eines Träger-Schließtags, welche Ferienbuchungen er betrifft
 * (#6434). Der Dialog zeigt das vor dem Speichern; das Speichern bestätigt mit
 * dem Zeichen der zuletzt gezeigten Vorschau. Eine ältere Antwort überschreibt
 * nie eine neuere. Beim Ändern und Löschen schickt die Vorschau den
 * gespeicherten Schließtag mit; dann nennt sie auch die Tage, die wieder
 * öffnen (#6457). Das Löschen braucht keinen Entwurf; seine Vorschau hält
 * `useClosingDayDeletePreview`.
 */

import { useCallback, useState } from "react";

import type { ClosingDayDraft } from "~/components/planning/closing-day-modal";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useReadDraft } from "~/lib/swr/read-draft";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  deleteTraegerClosingDay,
  previewTraegerClosingDayHolidayBookings,
  type HolidayClosureImpact,
  type TraegerClosingDay,
} from "~/lib/traeger-closing-days";
import { useDebounce } from "~/lib/use-debounce";

/** Wartezeit nach der letzten Änderung, bevor die Vorschau lädt. */
const PREVIEW_DELAY_MS = 300;

function completeDraft(
  draft: ClosingDayDraft | null,
): draft is ClosingDayDraft {
  return (
    draft !== null &&
    draft.startDate !== "" &&
    draft.endDate !== "" &&
    draft.endDate >= draft.startDate &&
    draft.schoolIds.length > 0
  );
}

/**
 * `saved` ist der gespeicherte Schließtag beim Ändern, `null` beim Anlegen.
 */
export function useClosingDayHolidayImpact(
  open: boolean,
  saved: TraegerClosingDay | null = null,
) {
  const [draft, setDraft] = useState<ClosingDayDraft | null>(null);
  const requested = open && completeDraft(draft) ? draft : null;
  // The preview loads once the draft rested; until then it is pending.
  const rested = useDebounce(requested, PREVIEW_DELAY_MS);
  const key =
    requested !== null && rested === requested
      ? traegerKeys.closingDayImpact(requested, saved, false)
      : null;
  // Die Vorschau kommt aus dem geteilten Cache (ADR 0311): das Speichern
  // bestätigt mit ihrem Zeichen, und der Server lehnt ab, wenn sich die
  // Buchungen seither geändert haben; dann lädt `reload` die neue Vorschau.
  const {
    data: impact,
    loading,
    error,
    reload,
  } = useTraegerResource(
    key,
    () =>
      requested
        ? previewTraegerClosingDayHolidayBookings(
            { ...requested, reason: "" },
            saved ? { closingDay: saved, delete: false } : undefined,
          )
        : Promise.reject(new Error("no closing day draft")),
    "die gebuchte Ferienbetreuung",
  );
  const pending = requested !== null && (key === null || loading);

  const onDraftChange = useCallback(
    (next: ClosingDayDraft) => setDraft(next),
    [],
  );

  return {
    onDraftChange,
    impact: requested ? impact : null,
    loading: pending,
    error: requested ? error : null,
    reload,
    /** Das Speichern wartet, bis die Vorschau zum Entwurf geladen ist. */
    blocked: requested !== null && (pending || impact === null),
  };
}

/**
 * Die Vorschau zum Löschen von `deleting` (#6457), als Bestätigung einer
 * Vorschau (ADR 0311): Der Dialog hält die Vorschau, die beim Öffnen
 * dastand, auch über ein späteres Lesen; „Endgültig löschen“ schickt ihr
 * Zeichen. Lehnt der Server ab, weil sich die Buchungen seither geändert
 * haben (`traeger.closing_day_bookings_changed`), liest `reload` des
 * Ergebnisses die neue Vorschau und lehnt ab, wenn das scheitert.
 */
export function useClosingDayDeletePreview(deleting: TraegerClosingDay | null) {
  const target = completeDraft(deleting) ? deleting : null;
  const preview = useReadDraft<
    HolidayClosureImpact,
    HolidayClosureImpact,
    string,
    number
  >({
    key: target ? traegerKeys.closingDayImpact(target, target, true) : null,
    fetcher: () =>
      target
        ? previewTraegerClosingDayHolidayBookings(
            { ...target, reason: "" },
            { closingDay: target, delete: true },
          )
        : Promise.reject(new Error("no closing day to delete")),
    token: (impact) => impact.token,
    follow: false,
    // Nach dem Löschen gibt es keinen Stand mehr zu lesen.
    answer: (_families, shown) => shown,
  });
  return {
    ...preview,
    /** Löscht mit dem Zeichen der gezeigten Vorschau; antwortet mit der Zahl der Familien. */
    confirm: () =>
      preview.submit((token) =>
        target
          ? deleteTraegerClosingDay(target.id, token)
          : Promise.reject(new Error("no closing day to delete")),
      ),
  };
}
