"use client";

import { useRef, useState } from "react";

import { useApiFormError } from "~/contexts/ToastContext";
import { useLatest } from "~/lib/hooks/use-latest";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { sendUnread, type ReadAction } from "~/lib/swr/read-draft";

const logger = createLogger({ component: "ConfirmAction" });

interface ConfirmActionOptions<T> {
  /** Runs after the confirmed call with its answer, before the dialog closes. */
  readonly onDone: (saved: T) => Promise<void> | void;
  readonly onClose: () => void;
  /** The step as the error text names it, e.g. „das Löschen der Umfrage“. */
  readonly object: string;
  readonly logEvent: string;
  /**
   * The read the dialog shows (ADR 0311): the step sends its token, a
   * refusal shows the stored state read again without „Wiederholen“, and
   * nothing goes out until that state is read.
   */
  readonly read?: ReadAction;
}

/**
 * A step a dialog asks about before it runs: one attempt at a time, the
 * failure stays in the open dialog (`error` for `FormErrorAlert`) with
 * „Wiederholen“ on the dialog's then current state, and success hands the
 * answer to `onDone` and closes.
 */
export function useConfirmAction<T>(
  run: () => Promise<T>,
  { onDone, onClose, object, logEvent, read }: ConfirmActionOptions<T>,
) {
  const [pending, setPending] = useState(false);
  const errors = useApiFormError();
  const form = useReadDraftForm(read ?? null, errors, object);

  // Synchronous for a second call before the render: it sends nothing and
  // leaves the running attempt's lock on the dialog alone.
  const running = useRef(false);

  const release = () => {
    running.current = false;
    setPending(false);
  };

  const confirm = async () => {
    if (running.current || !form.begin()) return;
    running.current = true;
    setPending(true);
    const result = await (read ? read.submit(run) : sendUnread(run));
    if (result.ok) {
      try {
        await onDone(result.saved);
      } finally {
        release();
        onClose();
      }
      return;
    }
    release();
    if (result.skipped) return;
    logger.error(logEvent, {
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    await errors.show(
      result.error,
      result.refused && result.reload
        ? { object, reload: result.reload }
        : { object, retry: () => void latestConfirm.current() },
    );
  };
  const latestConfirm = useLatest(confirm);

  return {
    pending,
    error: errors.error ?? form.loadError,
    confirm,
    blocked: read !== undefined && !read.canSubmit,
    blockedReason: form.waitReason,
  };
}
