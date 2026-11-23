"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { isReadStateRefusal } from "~/lib/api-error";
import { useOpeningRead } from "./hooks";

/**
 * An edit or a preview confirm on a read state (ADR 0311): the one
 * implementation of the rules every such surface follows.
 *
 * 1. The token is taken when editing starts and sent with the save.
 * 2. A newer read refills the draft only while it is untouched; a touched
 *    draft keeps its base and token (`newer` says the stored state moved).
 * 3. After a refusal the stored state is read again and shown.
 * 4. Between a refusal and that read nothing can be sent: the old token
 *    would be refused again (`canSubmit`).
 * 5. After a save the base is the save's answer (`answer`), else a read;
 *    a second save is never refused for the first one.
 * 6. A read after a refusal or a save that fails is a load error
 *    (`error`); SWR's own revalidation would resolve with the old data and
 *    hide it.
 *
 * Built on `useOpeningRead` with `showCached: true`: each opening reads
 * anew, a cached answer shows until then.
 */
export interface DraftOptions<T, D, K, A> {
  /** The read state's token: a version, a fingerprint, a list or map of them. */
  readonly token: (read: T) => K;
  /** The editable draft of a read; omitted, the read itself (a preview). */
  readonly toDraft?: (read: T) => D;
  /** Whether two drafts are the same; default: equal as JSON. */
  readonly same?: (a: D, b: D) => boolean;
  /**
   * After a refusal: the draft on the stored state `to`. Default: the
   * stored state alone (the input is gone). Only a surface that already
   * keeps drafts keeps input here (the meal plan's days).
   */
  readonly rebase?: (draft: D, from: T, to: T) => D;
  /** The stored state a save answered; undefined reads it again. */
  readonly answer?: (saved: A, base: T) => T | undefined;
  /** The refusal of a changed state; default `isReadStateRefusal`. */
  readonly isRefusal?: (error: unknown) => boolean;
}

export interface ReadDraftOptions<T, D, K, A> extends DraftOptions<T, D, K, A> {
  /** The read's key of `~/lib/swr`; `null` closes the surface. */
  readonly key: string | null;
  readonly fetcher: () => Promise<T>;
}

/**
 * The read a draft rests on, for `useDraftOn`: a list row, a shared read.
 * `useReadDraft` supplies its own opening read.
 */
export interface DraftSource<T> {
  /** One surface opening (a key, a row id); `null` closes it. */
  readonly opening: string | null;
  /** The newest read; a change of its token refills an untouched draft. */
  readonly data: T | undefined;
  /** The read failed and no confirmed state is there: nothing is sent. */
  readonly error?: unknown;
  /**
   * Reads the stored state again; rejects on failure (rule 6). Undefined:
   * the new state arrives through `data` (a list the caller reloaded).
   */
  readonly reload: () => Promise<T | undefined>;
  /** Hands a save's stored answer to the read (rule 5). */
  readonly write?: (stored: T) => Promise<unknown>;
}

export type ReadDraftStatus =
  "loading" | "ready" | "saving" | "refused" | "reloading" | "loadFailed";

export type ReadDraftResult<A> =
  | { readonly ok: true; readonly saved: A }
  | {
      readonly ok: false;
      readonly error: unknown;
      /** The state changed since it was read (rule 3). */
      readonly refused: boolean;
      /**
       * For `show(error, { reload })`: the read of the stored state that
       * the refusal started, then a new one per call. Rejects on failure.
       */
      readonly reload?: () => Promise<unknown>;
    };

export interface ReadDraft<T, D, K, A> {
  /** The read the draft rests on; its token goes with the save. */
  readonly base: T | undefined;
  readonly token: K | undefined;
  readonly draft: D | undefined;
  readonly setDraft: (next: D | ((current: D) => D)) => void;
  /** The draft differs from its base. */
  readonly touched: boolean;
  /** A newer read arrived under a touched draft; the draft kept its base. */
  readonly newer: boolean;
  readonly status: ReadDraftStatus;
  /** Only `ready` sends (rule 4). */
  readonly canSubmit: boolean;
  /** The failed read to show as a load error, with `retryLoad`. */
  readonly error: unknown;
  readonly retryLoad: () => void;
  /** Sends the draft with its token. Never throws. */
  readonly submit: (
    send: (token: K, draft: D) => Promise<A>,
  ) => Promise<ReadDraftResult<A>>;
  /** Drops the input: the draft of the newest read. */
  readonly discard: () => void;
}

type Phase = "ready" | "saving" | "refused" | "reloading" | "loadFailed";

interface DraftState<T, D> {
  readonly key: string;
  readonly base: T;
  readonly draft: D;
  readonly touched: boolean;
  readonly phase: Phase;
  readonly loadError?: unknown;
}

const asJSON = (value: unknown) => JSON.stringify(value);
const sameJSON = (a: unknown, b: unknown) => asJSON(a) === asJSON(b);

export function useReadDraft<T, D = T, K = unknown, A = unknown>(
  options: ReadDraftOptions<T, D, K, A>,
): ReadDraft<T, D, K, A> {
  const opened = useOpeningRead(options.key, options.fetcher, {
    showCached: true,
  });
  return useDraftOn(
    {
      opening: options.key,
      data: opened.latest ?? opened.data,
      // A failed opening read counts also over a cached draft: the server
      // would refuse a token it cannot confirm.
      error: opened.data === undefined ? opened.error : undefined,
      reload: opened.reload,
      write: (stored) => opened.mutate(stored, { revalidate: false }),
    },
    options,
  );
}

/** The rules of `useReadDraft` on a read the caller owns. */
export function useDraftOn<T, D = T, K = unknown, A = unknown>(
  source: DraftSource<T>,
  options: DraftOptions<T, D, K, A>,
): ReadDraft<T, D, K, A> {
  const { token } = options;
  const key = source.opening;
  const toDraft = options.toDraft ?? ((read: T) => read as unknown as D);
  const same = options.same ?? sameJSON;
  const newest = source.data;

  const [state, setState] = useState<DraftState<T, D> | null>(null);
  let current = state;
  if (key === null) {
    if (current !== null) {
      current = null;
      setState(null);
    }
  } else if (current === null || current.key !== key) {
    current =
      newest === undefined
        ? null
        : {
            key,
            base: newest,
            draft: toDraft(newest),
            touched: false,
            phase: "ready",
          };
    if (current !== state) setState(current);
  } else if (
    newest !== undefined &&
    !current.touched &&
    current.phase === "ready" &&
    !sameJSON(token(newest), token(current.base))
  ) {
    // Rule 2: an untouched draft follows the newest read.
    current = { ...current, base: newest, draft: toDraft(newest) };
    setState(current);
  }
  const newer =
    current !== null &&
    current.touched &&
    newest !== undefined &&
    !sameJSON(token(newest), token(current.base));

  const latest = useRef({ state: current, options, source, toDraft, same });
  useLayoutEffect(() => {
    latest.current = { state: current, options, source, toDraft, same };
  });

  /** Moves the state of `forKey` only; a new opening keeps its own. */
  const update = useCallback(
    (forKey: string, next: (prev: DraftState<T, D>) => DraftState<T, D>) => {
      setState((prev) =>
        prev !== null && prev.key === forKey ? next(prev) : prev,
      );
    },
    [],
  );

  const settle = useCallback(
    (forKey: string, read: T | undefined, from?: { draft: D; base: T }) => {
      const { options: given, toDraft: draftOf, same: equal } = latest.current;
      if (read === undefined) {
        // Untouched on the old base: the newest `data` refills it (rule 2).
        update(forKey, (prev) => ({
          ...prev,
          draft: draftOf(prev.base),
          touched: false,
          phase: "ready",
          loadError: undefined,
        }));
        return;
      }
      const stored = draftOf(read);
      const draft =
        from && given.rebase
          ? given.rebase(from.draft, from.base, read)
          : stored;
      update(forKey, () => ({
        key: forKey,
        base: read,
        draft,
        touched: !equal(draft, stored),
        phase: "ready",
      }));
    },
    [update],
  );

  /** Reads the stored state again; a failure stays until `retryLoad`. */
  const readAgain = useCallback(
    async (forKey: string, from?: { draft: D; base: T }) => {
      update(forKey, (prev) => ({ ...prev, phase: "reloading" }));
      try {
        const read = await latest.current.source.reload();
        settle(forKey, read, from);
        return read;
      } catch (error) {
        update(forKey, (prev) => ({
          ...prev,
          phase: "loadFailed",
          loadError: error,
        }));
        throw error;
      }
    },
    [settle, update],
  );

  const submit = useCallback(
    async (
      send: (token: K, draft: D) => Promise<A>,
    ): Promise<ReadDraftResult<A>> => {
      const { state: sent, options: given } = latest.current;
      if (sent === null || sent.phase !== "ready") {
        return {
          ok: false,
          error: new Error("read draft is not ready"),
          refused: false,
        };
      }
      const { key: forKey, base, draft } = sent;
      update(forKey, (prev) => ({ ...prev, phase: "saving" }));
      let saved: A;
      try {
        saved = await send(given.token(base), draft);
      } catch (error) {
        if ((given.isRefusal ?? isReadStateRefusal)(error)) {
          update(forKey, (prev) => ({ ...prev, phase: "refused" }));
          const from = { draft, base };
          const first = readAgain(forKey, from);
          // The caller may never ask: the failure is in `error` then.
          first.catch(() => undefined);
          let asked = false;
          const reload = () => {
            if (!asked) {
              asked = true;
              return first;
            }
            return readAgain(forKey, from);
          };
          return { ok: false, error, refused: true, reload };
        }
        update(forKey, (prev) => ({ ...prev, phase: "ready" }));
        return { ok: false, error, refused: false };
      }
      const stored = given.answer?.(saved, base);
      if (stored !== undefined) {
        await latest.current.source.write?.(stored);
        settle(forKey, stored);
      } else {
        await readAgain(forKey).catch(() => undefined);
      }
      return { ok: true, saved };
    },
    [readAgain, settle, update],
  );

  const setDraft = useCallback(
    (next: D | ((prev: D) => D)) => {
      const { state: now } = latest.current;
      if (now === null) return;
      update(now.key, (prev) => {
        const draft =
          typeof next === "function"
            ? (next as (prev: D) => D)(prev.draft)
            : next;
        return {
          ...prev,
          draft,
          touched: !latest.current.same(
            draft,
            latest.current.toDraft(prev.base),
          ),
        };
      });
    },
    [update],
  );

  const retryLoad = useCallback(() => {
    const { state: now } = latest.current;
    if (now !== null) void readAgain(now.key).catch(() => undefined);
    else void latest.current.source.reload().catch(() => undefined);
  }, [readAgain]);

  const discard = useCallback(() => {
    const { state: now, source: read } = latest.current;
    const stored = read.data ?? now?.base;
    if (now === null || stored === undefined) return;
    settle(now.key, stored);
  }, [settle]);

  const openFailed = source.error !== undefined;
  const phase: ReadDraftStatus = openFailed
    ? "loadFailed"
    : (current?.phase ?? "loading");
  return {
    base: current?.base,
    token: current ? token(current.base) : undefined,
    draft: current?.draft,
    setDraft,
    touched: current?.touched ?? false,
    newer,
    status: phase,
    canSubmit: phase === "ready",
    error: openFailed
      ? source.error
      : current?.phase === "loadFailed"
        ? current.loadError
        : undefined,
    retryLoad,
    submit,
    discard,
  };
}
