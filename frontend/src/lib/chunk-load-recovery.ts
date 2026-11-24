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

import { reloadOnce } from "./reload-once";

const RELOAD_MARKER_KEY = "moto:chunk-load-reload-at";

/** Turbopack and webpack name the error; the message is the fallback. */
const CHUNK_LOAD_MESSAGE =
  /Failed to load chunk|Loading (?:CSS )?chunk \S+ failed/;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  // A runtime that throws a plain Error carries the failed chunk only in the
  // text; no code or status exists for it.
  // oxlint-disable-next-line error-path/no-error-text-match -- bundler runtime error, not an API error: its text is the only carrier
  return CHUNK_LOAD_MESSAGE.test(error.message);
}

/**
 * Reloads the page once for a chunk load error. Returns true when a reload
 * was started; the caller then neither reports nor logs the error.
 */
export function reloadAfterChunkLoadError(error: unknown): boolean {
  return isChunkLoadError(error) && reloadOnce(RELOAD_MARKER_KEY);
}
