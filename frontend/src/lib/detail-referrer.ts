/**
 * Accept a return path only when it is an internal path of one of the
 * collections that may open a detail page. Query parameters and child paths
 * are retained, so filters and a room-to-student drill-in still work.
 */
export function resolveDetailReferrer(
  candidate: string | null,
  fallback: string,
  allowedPrefixes: readonly string[],
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    // Browsers treat a backslash like a slash in a URL. Checking the resolved
    // origin prevents `/\\example.test` from becoming a protocol-relative URL.
    const url = new URL(candidate, "https://moto.invalid");
    if (url.origin !== "https://moto.invalid") {
      return fallback;
    }
    // Validate the URL-normalized path, not the raw spelling. Otherwise an
    // allowed prefix such as `/rooms` would also accept `/rooms/../settings`.
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    return allowedPrefixes.some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(`${prefix}/`) ||
        normalized.startsWith(`${prefix}?`) ||
        normalized.startsWith(`${prefix}#`),
    )
      ? normalized
      : fallback;
  } catch {
    return fallback;
  }
}
