"use client";

import { createLogger } from "~/lib/logger";
import type {
  DraftRoster,
  OfferingSuggestionQuery,
} from "~/lib/offering-suggestion";
import type {
  OfferingPreview,
  OfferingSelection,
} from "~/lib/roster-deviation";
import { useFreshSWR } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { timetableService } from "~/lib/timetable-api";

import { useSwrResourceLoadError } from "./use-swr-load-error";

const logger = createLogger({ component: "useOfferingPreview" });

/**
 * Reads the preview of `key`; a null key reads nothing. A failed load is
 * shown where the preview is missing, with a retry.
 */
function usePreviewLoad(
  key: string | null,
  load: () => Promise<OfferingPreview>,
  logFields: Record<string, unknown>,
) {
  const { data, error, isLoading, mutate } = useFreshSWR(key, load, {
    keepPreviousData: false,
    onError: (err) =>
      logger.error("offering_preview_failed", {
        ...logFields,
        error: err instanceof Error ? err.message : String(err),
      }),
  });
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    "die Vorschau der Kinderliste",
    () => mutate(),
  );
  return { preview: data ?? null, loading: isLoading, error: loadError };
}

/**
 * Loads who joins and who leaves a Regeltermin per weekday when it takes its
 * children from the chosen offerings (#5103).
 */
export function useOfferingPreview(
  templateId: string | undefined,
  selection: OfferingSelection,
  from?: string,
) {
  const key =
    templateId && selection.offeringIds.length > 0
      ? tenantDailyKeys.offeringPreview(templateId, selection, from)
      : null;
  return usePreviewLoad(
    key,
    () =>
      from
        ? timetableService.getOfferingPreview(templateId!, selection, from)
        : timetableService.getOfferingPreview(templateId!, selection),
    { template_id: templateId },
  );
}

/**
 * The same preview for a Regeltermin that is not saved yet (#5104): it
 * compares the offering's children with the list the editor planned before
 * the switch.
 */
export function useDraftOfferingPreview(
  periodId: string,
  selection: OfferingSelection,
  roster: DraftRoster | null,
  from?: string,
  template?: Pick<OfferingSuggestionQuery, "type" | "listKind">,
) {
  const key =
    periodId && roster && selection.offeringIds.length > 0
      ? tenantDailyKeys.draftOfferingPreview(
          periodId,
          selection,
          roster,
          from,
          template,
        )
      : null;
  return usePreviewLoad(
    key,
    () =>
      timetableService.getDraftOfferingPreview(
        periodId,
        selection,
        roster ?? {},
        from,
        template,
      ),
    { period_id: periodId },
  );
}
