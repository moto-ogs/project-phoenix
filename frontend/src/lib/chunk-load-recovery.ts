/**
 * Recovery from a JavaScript chunk the browser could not load.
 *
 * Next.js loads parts of a page on demand. When such a request fails, the
 * runtime throws a `ChunkLoadError` and an error boundary shows the crash
 * page. Two causes are common: a weak connection (school tablets on Wi-Fi)
 * and a deploy that replaced the build while the tab stayed open, so the
 * old chunk no longer exists. A fresh page load fixes both, so the error
 * boundaries reload once instead of showing the crash page.
 *
 * A marker in sessionStorage stops a reload loop: a chunk that is still
 * missing after the reload is a real fault and reaches the crash page and
 * Sentry. Without sessionStorage there is no loop guard, so no reload.
 */

const RELOAD_MARKER_KEY = "moto:chunk-load-reload-at";

/** A second failure within this window counts as unrecovered. */
const RELOAD_GUARD_MS = 60_000;

/** Turbopack and webpack name the error; the message is the fallback. */
const CHUNK_LOAD_MESSAGE =
  /Failed to load chunk|Loading (?:CSS )?chunk \S+ failed/;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" || CHUNK_LOAD_MESSAGE.test(error.message)
  );
}

/**
 * Reloads the page once for a chunk load error. Returns true when a reload
 * was started; the caller then neither reports nor logs the error.
 */
export function reloadAfterChunkLoadError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem(RELOAD_MARKER_KEY));
    if (lastReload > 0 && now - lastReload < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_MARKER_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
