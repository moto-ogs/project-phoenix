/**
 * „Mehr Kontrast“: dunklere Ränder an Bedienelementen, gewählt pro Konto.
 *
 * Die Wahl gehört dem Konto (`~/lib/contrast-account`) und gilt damit
 * in jedem Portal und auf jedem Gerät. Ein Cookie spiegelt sie: das Root-Layout
 * setzt `html[data-contrast]` daraus schon im ersten HTML (kein Aufblitzen),
 * und die Anmeldeseite zeigt die letzte Wahl auf diesem Gerät. Ohne Wahl folgt
 * die Seite der Systemeinstellung `prefers-contrast: more` (`globals.css`).
 */
export const CONTRAST_COOKIE_NAME = "moto_contrast";

export type ContrastPreference = "more" | "normal";

let pendingAccountMutations = 0;
let accountMutationGeneration = 0;
const accountMutationListeners = new Set<() => void>();

function notifyAccountMutationListeners(): void {
  for (const listener of accountMutationListeners) listener();
}

/**
 * Marks a local account update so a response from an older account read cannot
 * replace the choice just made in this browser.
 */
export function beginAccountContrastMutation(): () => void {
  pendingAccountMutations += 1;
  accountMutationGeneration += 1;
  notifyAccountMutationListeners();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    pendingAccountMutations -= 1;
    notifyAccountMutationListeners();
  };
}

/** Whether an account update is queued or being saved in this browser. */
export function hasPendingAccountContrastMutation(): boolean {
  return pendingAccountMutations > 0;
}

/** Meldet, wenn eine Kontospeicherung beginnt oder endet. */
export function subscribeToAccountContrastMutation(
  onChange: () => void,
): () => void {
  accountMutationListeners.add(onChange);
  return () => {
    accountMutationListeners.delete(onChange);
  };
}

/** Changes whenever a local account update starts. */
export function accountContrastMutationGeneration(): number {
  return accountMutationGeneration;
}

export function parseContrastPreference(
  raw: string | null | undefined,
): ContrastPreference | undefined {
  return raw === "more" || raw === "normal" ? raw : undefined;
}

/**
 * Setzt die Wahl sofort am Dokument und merkt sie im Cookie; `undefined`
 * nimmt sie zurück, dann gilt die Systemeinstellung.
 */
export function applyContrastPreference(
  preference: ContrastPreference | undefined,
): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  if (preference === undefined) {
    delete document.documentElement.dataset.contrast;
    document.cookie = `${CONTRAST_COOKIE_NAME}=; path=/; max-age=0; samesite=lax${secure}`;
  } else {
    document.documentElement.dataset.contrast = preference;
    document.cookie = `${CONTRAST_COOKIE_NAME}=${preference}; path=/; max-age=31536000; samesite=lax${secure}`;
  }
  for (const listener of listeners) listener();
}

/** Die Wahl, die gerade am Dokument steht; `undefined`: keine. */
export function currentContrastPreference(): ContrastPreference | undefined {
  if (typeof document === "undefined") return undefined;
  return parseContrastPreference(document.documentElement.dataset.contrast);
}

const CONTRAST_QUERY = "(prefers-contrast: more)";
const listeners = new Set<() => void>();

/**
 * Meldet jede Änderung: eine neue Wahl (auch aus dem Konto-Abgleich) und eine
 * geänderte Systemeinstellung. Für `useSyncExternalStore`.
 */
export function subscribeToContrast(onChange: () => void): () => void {
  listeners.add(onChange);
  const query = window.matchMedia?.(CONTRAST_QUERY);
  query?.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    query?.removeEventListener("change", onChange);
  };
}

/** Ob die dunklen Ränder gerade gelten: eigene Wahl, sonst Systemeinstellung. */
export function isMoreContrastActive(): boolean {
  const chosen = currentContrastPreference();
  if (chosen) return chosen === "more";
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(CONTRAST_QUERY).matches ?? false;
}
