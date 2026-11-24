"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { createLogger } from "~/lib/logger";
import type { ReadDraftStatus } from "~/lib/swr/read-draft";

import { useApiLoadError } from "~/contexts/ToastContext";

/**
 * Shows the error of a failed SWR load where the data is missing (#2514):
 * catalog text, retry and request ID through `useApiLoadError`. Render the
 * returned value in `LoadErrorAlert` or TenantPage `error`. A successful
 * reload clears it.
 */
export function useSwrLoadError(
  error: unknown,
  object: string,
  retry: () => unknown,
  /** Context sentence after the catalog text, e.g. that shown data is old. */
  messageSuffix?: string,
) {
  const { error: shown, show, clear } = useApiLoadError();
  // The retry closes over the latest mutate, not the one of the failed load.
  const retryRef = useRef(retry);
  useLayoutEffect(() => {
    retryRef.current = retry;
  });

  // Clears only a shown error: a needless clear would cost every page a
  // render.
  const shownRef = useRef(false);

  useEffect(() => {
    if (error) {
      shownRef.current = true;
      void show(error, {
        object,
        messageSuffix,
        retry: () => void retryRef.current(),
      });
    } else if (shownRef.current) {
      shownRef.current = false;
      clear();
    }
  }, [error, object, messageSuffix, show, clear]);

  return shown;
}

interface SwrLoadResource {
  readonly data?: unknown;
  readonly error?: unknown;
  /** Partial failure payloads are not confirmed initial data. */
  readonly hasConfirmedData?: boolean;
}

const logger = createLogger({ component: "SwrLoadError" });

/**
 * A failed revalidation must not unmount confirmed content or open dialogs.
 * Only failures without confirmed data block rendering. Scope/access discards
 * still remove the data at the resource boundary, not in this presenter.
 */
export function useSwrResourceLoadError(
  resources: readonly SwrLoadResource[],
  object: string,
  retry: () => unknown,
) {
  const hasData = (resource: SwrLoadResource) =>
    resource.hasConfirmedData ?? resource.data !== undefined;
  const failure = resources.find((item) => item.error && !hasData(item))?.error;
  const backgroundError = resources.find(
    (item) => item.error && hasData(item),
  )?.error;
  useEffect(() => {
    if (backgroundError)
      logger.warn("swr_background_refresh_failed", {
        object,
        error:
          backgroundError instanceof Error
            ? backgroundError.message
            : String(backgroundError),
      });
  }, [backgroundError, object]);
  const error = useSwrLoadError(failure, object, retry);
  // Hide a previous presentation synchronously, even before its effect clears.
  return { error: failure ? error : null, failure };
}

/**
 * The load failure of a draft or an action of `~/lib/swr/read-draft`
 * (status `loadFailed`): the opening read, the read after a refusal or
 * after a save failed. Shown also while a draft is on screen, because nothing can
 * be sent until a read of the stored state succeeded (ADR 0311, rule 6);
 * its retry reads again (`retryLoad`). Render it in `LoadErrorAlert`.
 */
export function useReadDraftLoadError(
  draft: { readonly error: unknown; readonly retryLoad: () => void },
  object: string,
) {
  return useSwrLoadError(draft.error, object, draft.retryLoad);
}

/**
 * Why nothing on a read state can be sent yet (ADR 0311, rules 4 and 6),
 * for `disabledReason`: the stored state is still being read, or that read
 * failed and its load error, shown on the surface, offers „Wiederholen“.
 * Undefined while the state is ready to send or a save is on its way.
 */
export function readStateWaitReason(
  status: ReadDraftStatus,
): string | undefined {
  switch (status) {
    case "loading":
    case "refused":
    case "reloading":
      return "Die gespeicherten Angaben werden noch geladen.";
    case "loadFailed":
      return "Die gespeicherten Angaben konnten nicht geladen werden. Tippe in der Fehlermeldung auf „Wiederholen“.";
    default:
      return undefined;
  }
}

/**
 * The error path of a form on a draft of `~/lib/swr/read-draft` (ADR 0311,
 * rules 4 and 6), so that no form orders it wrong:
 *
 * - `begin()` starts a save: while nothing can be sent (`canSubmit`) it
 *   returns false and leaves the shown error in place, a failed read with
 *   its retry included; otherwise it clears the form's error.
 * - `loadError` is the draft's failed read for `LoadErrorAlert`, null while
 *   the form's own alert shows an error (it already names that read).
 * - `waitReason` says why saving waits (`readStateWaitReason`), for the
 *   save button's `disabledReason`.
 *
 * `draft` null: the form creates, no stored state is read, `begin` only
 * clears. Also takes an action of `useActionOn`.
 */
export function useReadDraftForm(
  draft: {
    readonly error: unknown;
    readonly retryLoad: () => void;
    readonly canSubmit: boolean;
    readonly status: ReadDraftStatus;
  } | null,
  formErrors: { readonly error: unknown; readonly clear: () => void },
  object: string,
) {
  const shown = useSwrLoadError(
    draft?.error,
    object,
    draft?.retryLoad ?? noRetry,
  );
  const begin = () => {
    if (draft !== null && !draft.canSubmit) return false;
    formErrors.clear();
    return true;
  };
  return {
    begin,
    loadError: draft?.error && !formErrors.error ? shown : null,
    waitReason: draft === null ? undefined : readStateWaitReason(draft.status),
  };
}

function noRetry() {
  // A creating form reads nothing: there is no read to retry.
}
