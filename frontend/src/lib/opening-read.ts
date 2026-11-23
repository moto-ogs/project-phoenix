import { useEffect, useRef, useState } from "react";

/**
 * The read an opened form is filled on (ADR 0311). A cached read shows at
 * once; each opening runs its own read through the shared cache, also when
 * a read of the key ran a moment ago, and then holds that answer, so a
 * background read never swaps the form under typed input. A first read
 * that fails is shown as failed, also over cached data: the server would
 * refuse a write on data it cannot confirm. The failure stays until a read
 * of the opening answers; a retry that fails again changes nothing on
 * screen.
 */
export interface OpeningRead<T> {
  /** Cached data until the opening's read answers, then that answer. */
  readonly data: T | undefined;
  /** The opening's own read has answered. */
  readonly settled: boolean;
  /** The opening's read failed; the caller shows it instead of the data. */
  readonly error: unknown;
  /** Reads again. Until it answers, a failure stays shown. */
  readonly retry: () => void;
  /**
   * Reads again and holds the answer (a reload after a refusal). A failure
   * is thrown and leaves the opening as it is.
   */
  readonly reload: () => Promise<T>;
}

/** What the opening's own read needs of its `useSWRAuth` read. */
export interface OpeningSource<T> {
  readonly data: T | undefined;
  readonly mutate: (
    data: Promise<T>,
    options: { revalidate: false },
  ) => Promise<T | undefined>;
}

interface Outcome {
  readonly opening: string | number;
  readonly attempt: number;
  readonly failed: boolean;
  readonly error?: unknown;
}

interface Held<T> {
  readonly opening: string | number;
  readonly attempt: number;
  readonly data: T | undefined;
}

/**
 * The options of the form's `useSWRAuth` read. SWR starts automatic reads
 * on a key change even with mount revalidation off; paused, the opening's
 * own read is the only one the form starts. It still shows the cache.
 */
export const openingReadOptions = { isPaused: () => true } as const;

/**
 * The opening state of a form. `opening` names one opening (a cache key or
 * an opening counter); `null` closes it, and the next value starts a new
 * one. The read takes `openingReadOptions`.
 */
export function useOpeningRead<T>(
  opening: string | number | null,
  source: OpeningSource<T>,
  load: () => Promise<T>,
): OpeningRead<T> {
  const [attempts, setAttempts] = useState<{
    opening: string | number | null;
    count: number;
  }>({ opening, count: 0 });
  const attempt = attempts.opening === opening ? attempts.count : 0;
  const [outcome, setOutcome] = useState<Outcome>();
  const [held, setHeld] = useState<Held<T>>();
  const latest = useRef({ load, mutate: source.mutate });
  useEffect(() => {
    latest.current = { load, mutate: source.mutate };
  });

  useEffect(() => {
    if (opening === null) return;
    let current = true;
    const { load: read, mutate } = latest.current;
    // Through the shared cache: the answer lands there, the opening only
    // notes that it came.
    mutate(read(), { revalidate: false }).then(
      () => {
        if (current) setOutcome({ opening, attempt, failed: false });
      },
      (error: unknown) => {
        if (current) setOutcome({ opening, attempt, failed: true, error });
      },
    );
    return () => {
      current = false;
    };
  }, [opening, attempt]);

  const answered =
    opening !== null && outcome?.opening === opening ? outcome : undefined;
  // The render after the answer takes it from the cache and holds it.
  if (
    answered &&
    !answered.failed &&
    (held?.opening !== opening || held.attempt < answered.attempt)
  ) {
    setHeld({
      opening: answered.opening,
      attempt: answered.attempt,
      data: source.data,
    });
  }
  const own = held?.opening === opening ? held : undefined;
  const failed =
    answered?.failed === true &&
    (own === undefined || own.attempt < answered.attempt);

  const retry = () => {
    setAttempts({ opening, count: attempt + 1 });
  };
  const reload = async () => {
    const data = await latest.current.mutate(latest.current.load(), {
      revalidate: false,
    });
    // Held over any read of the opening still under way.
    if (opening !== null) {
      setHeld({ opening, attempt: Number.MAX_SAFE_INTEGER, data });
    }
    return data as T;
  };

  if (failed) {
    return {
      data: undefined,
      settled: true,
      error: answered.error,
      retry,
      reload,
    };
  }
  if (own) {
    return {
      data: own.data ?? source.data,
      settled: true,
      error: undefined,
      retry,
      reload,
    };
  }
  return { data: source.data, settled: false, error: undefined, retry, reload };
}
