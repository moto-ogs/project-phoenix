"use client";

import { useMemo } from "react";

import type { FormError } from "~/components/ui/form-error";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { PARENT_RESOURCE_OPTIONS } from "~/lib/hooks/use-parent-resources";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { getRequestSharingOptions } from "~/lib/parent-api";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

/**
 * Loads the guardians a request may be shared with. Every selector of a
 * child reads the same cached response.
 *
 * A failed load goes through the shared error path (#2518): `error` carries
 * the localized message with retry, `failed` tells the selector that no
 * choice is possible right now.
 */
export function useSharingOptions(studentId: string): {
  state: parentMeContract.requestSharingResponse | null;
  failed: boolean;
  error: FormError | null;
} {
  const t = useCareTermTranslations("parentRequestSharing");
  const {
    data,
    error: failure,
    mutate,
  } = useSWRAuth(
    parentKeys.sharingOptions(studentId),
    () => getRequestSharingOptions(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const state = data ?? null;
  const failed = !state && !!failure;
  const error = useSwrLoadError(
    failed ? failure : undefined,
    t("errorObjectRecipients"),
    () => mutate(),
    t("optionsHint"),
  );
  return useMemo(
    () => ({ state, failed, error: failed ? error : null }),
    [error, failed, state],
  );
}
