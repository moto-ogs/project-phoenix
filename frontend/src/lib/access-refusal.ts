/**
 * Refusals of data the screen already shows (#6801). A revalidation that the
 * server refuses (401/403) keeps SWR's data next to the error; nothing
 * rejects, so a caller that reloads through SWR cannot see the refusal.
 * The SWR middleware counts these refusals here, and
 * `useRefreshAfterWrite` compares the count around its reload.
 */

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

let shownDataRefusals = 0;

/** A refused revalidation of a key that still holds shown data. */
export function noteShownDataRefusal(): void {
  shownDataRefusals++;
}

/** How many refusals of shown data this tab has seen so far. */
export function shownDataRefusalCount(): number {
  return shownDataRefusals;
}
