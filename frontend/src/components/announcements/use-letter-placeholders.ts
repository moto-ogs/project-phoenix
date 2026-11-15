"use client";

import { useMemo } from "react";

import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  fetchLetterPlaceholders,
  type LetterPlaceholder,
} from "~/lib/parent-announcements-api";
import { useSWRAuth } from "~/lib/swr";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";

/**
 * The placeholders an Elternbrief may name (#4813), as the backend lists
 * them, with their labels by name and the load error to show.
 */
export function useLetterPlaceholders(apiBase: string | undefined) {
  const { data, error, mutate } = useSWRAuth<LetterPlaceholder[]>(
    parentAnnouncementKeys.letterPlaceholders(apiBase),
    () => fetchLetterPlaceholders(apiBase),
    { revalidateOnFocus: false },
  );
  const loadError = useSwrLoadError(error, "die Liste der Platzhalter", () =>
    mutate(),
  );
  const labels = useMemo(
    () => new Map((data ?? []).map((p) => [p.name, p.label])),
    [data],
  );
  return { placeholders: data, labels, loadError };
}
