/**
 * The read an opened form is filled on (ADR 0311). A cached read shows at
 * once; the opening follows its own first read and then holds that data, so
 * a background read never swaps the form under typed input. A first read
 * that fails is shown as failed, also over cached data: the server would
 * refuse a write on data it cannot confirm.
 */
export interface OpenedRead<T> {
  /** The opening: a cache key or an opening counter. */
  readonly key: string | number;
  readonly data: T | undefined;
  /** The opening's own read has begun. */
  readonly started: boolean;
  /** That read is over; from now on the data is held. */
  readonly settled: boolean;
  /** That read failed; the caller shows its error instead of the data. */
  readonly failed: boolean;
}

interface ReadState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isValidating: boolean;
}

/**
 * The opening state after this render's read state: the same object while
 * nothing changes, so a caller can set it during render without a loop.
 * A cached read can start without `isValidating`, so the opening only
 * settles after it saw its read run.
 */
export function followOpeningRead<T>(
  current: OpenedRead<T> | undefined,
  key: string | number,
  read: ReadState<T>,
): OpenedRead<T> | undefined {
  const follows = !current || !current.settled || current.failed;
  if (!follows) return current;
  const started = (current?.started ?? false) || read.isValidating;
  const settled = started && !read.isValidating;
  const failed = settled && read.error !== undefined;
  if (
    current !== undefined &&
    current.data === read.data &&
    current.started === started &&
    current.settled === settled &&
    current.failed === failed
  ) {
    return current;
  }
  if (!current && read.data === undefined && !started) return undefined;
  return { key, data: read.data, started, settled, failed };
}

/** The opening after a read the caller ran itself (a reload after a refusal). */
export function settledRead<T>(key: string | number, data: T): OpenedRead<T> {
  return { key, data, started: true, settled: true, failed: false };
}
