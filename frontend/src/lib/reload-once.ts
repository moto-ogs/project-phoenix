/** A second reload for the same cause within this window would be a loop. */
const RELOAD_GUARD_MS = 60_000;

/**
 * Reloads the page unless the same cause (`markerKey`) reloaded it less than a
 * minute ago: a cause a fresh page load does not fix is a real fault and must
 * reach the caller instead. Without sessionStorage there is no loop guard, so
 * no reload. Returns true when the reload started.
 */
export function reloadOnce(markerKey: string): boolean {
  try {
    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem(markerKey));
    if (lastReload > 0 && now - lastReload < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(markerKey, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
