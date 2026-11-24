/** An unreadable answer after a possible commit calls for reload, not resend. */
export function commits(route: {
  readonly method: string;
  readonly noCommit?: string;
}): boolean {
  return route.method !== "GET" && route.noCommit === undefined;
}
