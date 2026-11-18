/**
 * Everything the frontend knows about a refused read: what counts as a
 * refusal, which keys are refused right now, and how often shown data was
 * refused (#6801).
 *
 * The predicates, from wide to narrow:
 * - `isRefusal`: 401, 403 or 404. The session, the right or the object is
 *   gone, so nothing loaded before may be shown again.
 * - `isAccessRefusal`: 401 or 403, whatever the code.
 * - `isReadRefusal`: 401 or 403 as a decision about the right to read.
 */
import { ApiError } from "~/lib/api-error";

const REFUSAL_STATUSES = new Set([401, 403, 404]);

/** The server refused the request: 401, 403 or 404. */
export function isRefusal(failure: unknown): failure is ApiError {
  return (
    failure instanceof ApiError && REFUSAL_STATUSES.has(failure.status ?? 0)
  );
}

/** The server refused the account access (401/403), whatever the code. */
export function isAccessRefusal(error: unknown): error is { status: number } {
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  return status === 401 || status === 403;
}

// A 401/403 that says nothing about the right to read: the service is away,
// or this tab's session belongs to another account (TenantGuard switches it).
const NO_ACCESS_DECISION = new Set([
  "general.unavailable",
  "general.server",
  "identity.session_account_mismatch",
]);

/**
 * The server decided that the account may not read this: the shared reader
 * withdraws the key's data on it (~/lib/swr, useSWRAuth).
 */
export function isReadRefusal(error: unknown): boolean {
  if (!isAccessRefusal(error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code !== "string" || !NO_ACCESS_DECISION.has(code);
}

/*
 * Refusals in force, by the complete school/account-scoped SWR key. A
 * refusal holds for the whole tab until a read of the key succeeds; logout
 * and an account switch lift all of them (~/lib/swr/hooks).
 */
const refusals = new Map<string, unknown>();
const refusalListeners = new Set<() => void>();

function announceRefusals() {
  for (const listener of refusalListeners) listener();
}

export function refusalFor(key: string) {
  return refusals.get(key);
}

export function subscribeRefusals(listener: () => void) {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

export function markRefused(key: string, error: unknown) {
  refusals.set(key, error);
  announceRefusals();
}

export function liftRefusal(key: string) {
  if (refusals.delete(key)) announceRefusals();
}

export function liftAllRefusals() {
  if (refusals.size === 0) return;
  refusals.clear();
  announceRefusals();
}

/*
 * A revalidation that the server refuses keeps SWR's data next to the error;
 * nothing rejects, so a caller that reloads through SWR cannot see the
 * refusal. The shared reader counts these refusals here, and
 * `useRefreshAfterWrite` compares the count around its reload.
 */
let shownDataRefusals = 0;

/** A refused revalidation of a key that still holds shown data. */
export function noteShownDataRefusal(): void {
  shownDataRefusals++;
}

/** How many refusals of shown data this tab has seen so far. */
export function shownDataRefusalCount(): number {
  return shownDataRefusals;
}
