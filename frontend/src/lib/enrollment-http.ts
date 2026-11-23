/** The query parameter that carries a late-invite token, on pages and API paths. */
export const LATE_INVITE_QUERY_PARAM = "late_invite";

/** Appends the late-invite token to a path or URL; no token, no change. */
export function withLateInviteQuery(
  url: string,
  token: string | null | undefined,
): string {
  const trimmed = token?.trim();
  if (!trimmed) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${LATE_INVITE_QUERY_PARAM}=${encodeURIComponent(trimmed)}`;
}
