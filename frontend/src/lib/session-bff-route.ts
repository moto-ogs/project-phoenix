const SESSION_TYPES = Symbol("session BFF types");

/** The browser contract of a named session route, not Go's token reply. */
export interface SessionBffRoute<T, B> {
  readonly method: "POST";
  readonly path: `/api/${string}`;
  readonly [SESSION_TYPES]: { answer: T; body: B } | undefined;
}

export function sessionPost<T, B = undefined>(
  path: `/api/${string}`,
): SessionBffRoute<T, B> {
  return { method: "POST", path, [SESSION_TYPES]: undefined };
}
