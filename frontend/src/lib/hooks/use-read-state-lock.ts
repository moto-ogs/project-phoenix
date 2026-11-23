"use client";

import { useCallback, useRef, useState } from "react";

import type { ReadDraftStatus } from "~/lib/swr/read-draft";

/**
 * Why an action on a read state cannot be sent yet (ADR 0311, rules 4
 * and 6), for `disabledReason`: the stored state is still being read, or
 * that read failed and its load error offers „Wiederholen“. Undefined while
 * the state is ready to send.
 */
export function readStateWaitReason(
  status: ReadDraftStatus | ReadStateLockStatus,
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

export type ReadStateLockStatus = "ready" | "reloading" | "loadFailed";

/**
 * Rule 4 of ADR 0311 for an action without a draft (a switch, a row action,
 * a dialog sending what the page shows): from a refusal until the read of
 * the stored state settled, nothing is sent, because the shown token would
 * be refused again. `guard(reload)` is the `reload` for
 * `show(error, { reload })`; the error display calls it only on a
 * read-state refusal. A failed read keeps the lock: its load error's
 * „Wiederholen“ runs the guarded read again, and a successful one lifts it.
 *
 * `run(action)` also locks while the action itself is on its way, so a
 * second click sends nothing on the same token. `reset()` lifts the lock
 * for a new opening of a dialog, which reads the stored state anew.
 */
export function useReadStateLock() {
  const [status, setStatus] = useState<ReadStateLockStatus>("ready");
  const [running, setRunning] = useState(false);
  // Synchronous for a second click before the render.
  const busy = useRef(false);
  const lockedNow = useRef(false);
  const reads = useRef(0);

  const guard = useCallback(
    <T>(reload: () => Promise<T>) =>
      async (): Promise<T> => {
        const read = ++reads.current;
        lockedNow.current = true;
        setStatus("reloading");
        try {
          const result = await reload();
          if (read === reads.current) {
            lockedNow.current = false;
            setStatus("ready");
          }
          return result;
        } catch (error) {
          if (read === reads.current) setStatus("loadFailed");
          throw error;
        }
      },
    [],
  );

  const reset = useCallback(() => {
    // A read still on its way belongs to the old opening.
    reads.current++;
    lockedNow.current = false;
    setStatus("ready");
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current || lockedNow.current) return;
    busy.current = true;
    setRunning(true);
    try {
      await action();
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, []);

  const locked = status !== "ready";
  return {
    status,
    /** Nothing may be sent: a refusal's read is open or failed. */
    locked,
    /** Locked, or an action of `run` is on its way. */
    busy: locked || running,
    /** For `disabledReason` while `locked`. */
    reason: readStateWaitReason(status),
    guard,
    run,
    reset,
  };
}
