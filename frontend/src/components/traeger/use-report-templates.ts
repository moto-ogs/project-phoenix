"use client";

import { useSession } from "next-auth/react";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchReportTemplates } from "~/lib/traeger-reports-api";

/** Die Berichtsvorlagen des Trägers (#4716): keine Personendaten. */
export function useReportTemplates() {
  const { data: session } = useSession();
  const response = useSWRAuth(
    session?.user.scope === "org" ? traegerKeys.reportTemplates() : null,
    fetchReportTemplates,
    { keepPreviousData: false },
  );
  const error = useSwrLoadError(
    response.error,
    "die Vorlagen",
    response.mutate,
  );
  return {
    templates: response.data ?? null,
    error,
    mutate: response.mutate,
    /** Liest neu und scheitert laut (ADR 0311, Regel 6). */
    reload: () => revalidateOrThrow(response),
  };
}
