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
 *    (`status` `loadFailed`, `error`); SWR's own revalidation would resolve
 *    with the old data and hide it. Show `error` whether or not a draft is
 *    on screen (`useReadDraftLoadError` of `~/lib/hooks/use-swr-load-error`):
 *    nothing can be sent until a read of the stored state succeeded, by
 *    `retryLoad` or by a newer read arriving after the save went out. Until
 *    then `discard` returns to the draft as saved, not to the state the
 *    save replaced.
 *
 * Built on `useOpeningRead` with `showCached: true`: each opening reads
 * anew, a cached answer shows until then. The draft belongs to one
 * opening: a scope or data generation bump starts a new one.
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
  /**
   * Rule 2 for a preview a two-step confirm confirms: `false` holds the
   * read shown when the surface opened, also over this opening's own read,
   * so the confirm sends the token of what was on screen; `newer` says a
   * newer read arrived. A refusal reads the stored state as usual.
   * Default `true`: an untouched draft follows the newest read.
   */
  readonly follow?: boolean;
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
  /**
   * One surface opening (a key, a row id); `null` closes it. Not bound to
   * the session's scope: another account or school leaves the page
   * (`SWRScopeBoundary`, `PersonalStorageGuard`), and a draft kept over a
   * change of rights only carries a staleness token; the server authorizes
   * the save under the session that sends it.
   */
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
  /**
   * The failed read (status `loadFailed`) to show as a load error with
   * `retryLoad`, also while a draft is on screen: never hide it behind
   * shown data (`useReadDraftLoadError`).
   */
  readonly error: unknown;
  readonly retryLoad: () => void;
  /** Sends the draft with its token. Never throws. */
  readonly submit: (
    send: (token: K, draft: D) => Promise<A>,
  ) => Promise<ReadDraftResult<A>>;
  /**
   * Drops the input: the draft of the newest read. After a refusal or a
   * failed read only the input goes; sending still waits for a read.
   */
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
  /**
   * After a refusal: the refused draft on its base, for `rebase`, until
   * the stored state is read (`retryLoad` keeps it, `discard` drops it).
   */
  readonly refused?: { readonly draft: D; readonly base: T };
  /**
   * The stored state arrives through `data` (a list the caller reloads):
   * a read with another token than `base` settles the draft.
   */
  readonly awaiting?: true;
  /**
   * The newest read when the last save went out. A failed read after it
   * ends only through a read that arrived later: this one may predate the
   * save, or the refusal that said the stored state moved on.
   */
  readonly sent?: T;
  /**
   * After a save until its result is read: the draft as saved, which the
   * stored state now holds while `base` is still the state it replaced.
   * `touched` and `discard` measure against it.
   */
  readonly saved?: D;
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
      // The key under the session's scope and its data generation, as
      // `useOpeningRead` counts openings: a bump drops the draft.
      opening: opened.opening,
      data:
        options.follow === false ? opened.data : (opened.latest ?? opened.data),
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
/**
 * The draft on `read`, ready to send: after a refusal `rebase` may keep the
 * refused input.
 */
function settled<T, D>(
  prev: DraftState<T, D>,
  read: T,
  rebase: ((draft: D, from: T, to: T) => D) | undefined,
  toDraft: (read: T) => D,
  same: (a: D, b: D) => boolean,
): DraftState<T, D> {
  const stored = toDraft(read);
  const draft =
    prev.refused && rebase
      ? rebase(prev.refused.draft, prev.refused.base, read)
      : // Input typed after a save rests on the saved draft: a read that
        // brings exactly it keeps the input; any other state replaces it.
        !prev.refused && prev.saved !== undefined && same(stored, prev.saved)
        ? prev.draft
        : stored;
  // A fresh state: `sent` and `saved` belong to the reads before this one.
  return {
    key: prev.key,
    base: read,
    draft,
    touched: !same(draft, stored),
    phase: "ready",
  };
}

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
  const differs = (read: T, base: T) => !sameJSON(token(read), token(base));
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
    (current.awaiting === true ||
      (current.phase === "loadFailed" && newest !== current.sent)) &&
    differs(newest, current.base)
  ) {
    // Rule 3: the stored state a refusal waited for arrived, or a read
    // after a failed one (rule 6): the draft rests on it, and sends again.
    current = settled(current, newest, options.rebase, toDraft, same);
    setState(current);
  } else if (
    newest !== undefined &&
    options.follow !== false &&
    !current.touched &&
    current.phase === "ready" &&
    differs(newest, current.base)
  ) {
    // Rule 2: an untouched draft follows the newest read.
    current = { ...current, base: newest, draft: toDraft(newest) };
    setState(current);
  }
  const newer =
    current !== null &&
    (current.touched || options.follow === false) &&
    newest !== undefined &&
    differs(newest, current.base);

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
    (forKey: string, read: T | undefined) => {
      if (read === undefined) {
        // The read arrives through `data`: wait for it (above), sending
        // nothing until then.
        update(forKey, (prev) => ({
          ...prev,
          phase: "reloading",
          loadError: undefined,
          awaiting: true,
        }));
        return;
      }
      const { options: given, toDraft: draftOf, same: equal } = latest.current;
      update(forKey, (prev) =>
        settled(prev, read, given.rebase, draftOf, equal),
      );
    },
    [update],
  );

  /** Reads the stored state again; a failure stays until `retryLoad`. */
  const readAgain = useCallback(
    async (forKey: string) => {
      update(forKey, (prev) => ({ ...prev, phase: "reloading" }));
      try {
        const read = await latest.current.source.reload();
        settle(forKey, read);
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
      const shown = latest.current.source.data;
      update(forKey, (prev) => ({ ...prev, phase: "saving", sent: shown }));
      let saved: A;
      try {
        saved = await send(given.token(base), draft);
      } catch (error) {
        if ((given.isRefusal ?? isReadStateRefusal)(error)) {
          update(forKey, (prev) => ({
            ...prev,
            phase: "refused",
            refused: { draft, base },
          }));
          const first = readAgain(forKey);
          // Not silent: a failure is the draft's `error` (status
          // `loadFailed`), which the surface shows; the caller may also
          // never ask for this promise.
          first.catch(() => undefined);
          let asked = false;
          const reload = () => {
            if (!asked) {
              asked = true;
              return first;
            }
            return readAgain(forKey);
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
        update(forKey, (prev) => ({
          ...prev,
          saved: draft,
          touched: !latest.current.same(prev.draft, draft),
        }));
        // The save succeeded; a failed read of its result is the draft's
        // `error` (status `loadFailed`), shown by the surface, and nothing
        // is sent until a read succeeds (rule 6). It does not undo `ok`.
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
            prev.saved ?? latest.current.toDraft(prev.base),
          ),
        };
      });
    },
    [update],
  );

  // A failure of these reads shows as the draft's `error` again.
  const retryLoad = useCallback(() => {
    const { state: now } = latest.current;
    // A refusal's draft stays in the state: `rebase` keeps its input.
    if (now !== null) void readAgain(now.key).catch(() => undefined);
    else void latest.current.source.reload().catch(() => undefined);
  }, [readAgain]);

  const discard = useCallback(() => {
    const { state: now, source: read } = latest.current;
    if (now === null) return;
    if (now.phase !== "ready") {
      // After a refusal or a failed read the base is not the stored state:
      // only the input goes, back to what was saved last; sending waits for
      // a successful read (rule 4).
      update(now.key, (prev) => ({
        ...prev,
        draft: prev.saved ?? latest.current.toDraft(prev.base),
        touched: false,
        refused: undefined,
      }));
      return;
    }
    const stored = read.data ?? now.base;
    settle(now.key, stored);
  }, [settle, update]);

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
