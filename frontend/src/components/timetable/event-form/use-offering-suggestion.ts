"use client";

import { createLogger } from "~/lib/logger";
import type {
  OfferingSuggestion,
  OfferingSuggestionQuery,
} from "~/lib/offering-suggestion";
import { useSWRAuth } from "~/lib/swr";
import { timetableKeys } from "~/lib/swr/portal-keys";
import { timetableService } from "~/lib/timetable-api";
import { useDebounce } from "~/lib/use-debounce";

const logger = createLogger({ component: "useOfferingSuggestion" });

/** Wait this long after the last change before asking the backend. */
const SUGGESTION_DEBOUNCE_MS = 400;

/**
 * Asks which offering matches the children the editor plans (#5104). It
 * waits until the selection rests, so typing never makes the line flicker.
 * The suggestion is information only: a failed read shows nothing and is
 * logged. A null query clears the suggestion at once.
 */
export function useOfferingSuggestion(
  query: OfferingSuggestionQuery | null,
): OfferingSuggestion | null {
  const serialized = query ? JSON.stringify(query) : null;
  const rested = useDebounce(serialized, SUGGESTION_DEBOUNCE_MS);
  const asked =
    serialized === null || rested === null
      ? null
      : (JSON.parse(rested) as OfferingSuggestionQuery);
  const read = useSWRAuth(
    asked ? timetableKeys.offeringSuggestion(asked) : null,
    () =>
      asked
        ? timetableService.getOfferingSuggestion(asked)
        : Promise.resolve(null),
    {
      // While the next answer is pending the last one stays, so a changed
      // weekday does not make the line vanish and come back.
      keepPreviousData: true,
      // Bewusst ohne Anzeige und ohne Wiederholung: der Vorschlag ist nur
      // ein Hinweis, der Regeltermin lässt sich ohne ihn genauso anlegen.
      shouldRetryOnError: false,
      onError: (err: unknown) => {
        logger.warn("offering_suggestion_failed", {
          period_id: asked?.periodId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    },
  );

  if (serialized === null || read.error !== undefined) return null;
  return read.data ?? null;
}
