/**
 * The wait after too many „Passwort vergessen“ requests, per address.
 *
 * The backend counts requests per address, for addresses with and without
 * an account alike (#7213). So the wait belongs to the address it was
 * reported for: a typo that ran into the limit must not block the right
 * address for an hour.
 *
 * Storage is per origin and every portal has its own host, so one key serves
 * them all. The entry survives logout (`KEPT_STORAGE_KEYS`), so it holds no
 * address: each address is stored as a 32-bit FNV-1a hash. Many addresses
 * share a hash, so an entry cannot tell which address was entered; a rare
 * collision only shows a wait the backend would not enforce.
 */
const STORAGE_KEY = "passwordResetWaits";

/** The single, address-less wait of earlier versions. */
const LEGACY_STORAGE_KEY = "passwordResetRateLimitUntil";

type Waits = Record<string, number>;

/** The backend trims and lowercases the address before it counts. */
export function normalizeResetAddress(address: string): string {
  return address.trim().toLowerCase();
}

function addressKey(address: string): string {
  let hash = 0x811c9dc5;
  for (const char of normalizeResetAddress(address)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked storage (private mode, policy): the wait lives in the dialog only.
    return null;
  }
}

/** The stored waits that still run at `now`; expired ones are dropped. */
export function readResetWaits(now: number): Waits {
  const store = storage();
  if (!store) return {};
  store.removeItem(LEGACY_STORAGE_KEY);
  let parsed: unknown;
  try {
    parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // A damaged entry only loses the wait; the backend still enforces it.
    parsed = {};
  }
  const waits: Waits = {};
  if (typeof parsed === "object" && parsed !== null) {
    for (const [key, until] of Object.entries(parsed)) {
      if (typeof until === "number" && until > now) waits[key] = until;
    }
  }
  writeWaits(waits);
  return waits;
}

function writeWaits(waits: Waits): void {
  const store = storage();
  if (!store) return;
  if (Object.keys(waits).length === 0) {
    store.removeItem(STORAGE_KEY);
    return;
  }
  // Numeric rate-limit expiries keyed by address hash, no token.
  store.setItem(STORAGE_KEY, JSON.stringify(waits));
}

/** When the address may request again, or null when it may right now. */
export function resetWaitUntil(
  waits: Waits,
  address: string,
  now: number,
): number | null {
  const until = waits[addressKey(address)];
  return until !== undefined && until > now ? until : null;
}

/** Records the wait the backend reported for the address. */
export function rememberResetWait(
  waits: Waits,
  address: string,
  until: number,
  now: number,
): Waits {
  const next = { ...waits, [addressKey(address)]: until };
  for (const [key, value] of Object.entries(next)) {
    if (value <= now) delete next[key];
  }
  writeWaits(next);
  return next;
}
