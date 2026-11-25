import type { PortalKey } from "./portal-paths";

/**
 * The session mark of a portal (#8082): a second cookie beside the portal's
 * session cookie that scripts may read. The one exit of session cookies
 * (session-cookie-writes.ts) writes it with every session it lets go and
 * deletes it with the session. Its value is an HMAC under the server's
 * secret of the session's refresh-token family and, for a staff preview, the
 * preview: no person, account, school or token can be read from it, and it
 * opens nothing. A token rotation keeps the family, and so the mark.
 *
 * Every protected tree belongs to the mark its page was rendered with.
 * SessionTreeBoundary compares the cookie's mark with it, without a request,
 * whenever the tab shows again, resumes or the browser reports a cookie
 * change; another mark means the session cookie changed under this tab (a
 * login, logout or school switch in another tab, on the shared tenant
 * cookie also another school's subdomain, which no storage event or
 * broadcast reaches). The tree goes, and the page offers to load again.
 */

/** The mark's name, beside the session cookie of `portal`. */
export function sessionMarkName(
  portal: PortalKey,
  tenantDomain: string | undefined,
): string {
  if (portal !== "tenant") return `${portal}.session-mark`;
  return !tenantDomain || tenantDomain === "localhost"
    ? "authjs.session-mark"
    : `${tenantDomain.replace(/\./g, "-")}.session-mark`;
}

/**
 * The answer header in which the exit names the marks it wrote
 * (`<name>=<value>, …`): only the tab whose own request wrote them reads it.
 */
export const SESSION_MARK_HEADER = "X-Moto-Session-Mark";

/**
 * The request header in which an exit names the session it ends (#8082):
 * `<portal> <mark>` (`-` for a session without one), the mark the cookie
 * held for it. The exit of session cookies deletes nothing of another
 * session (another tab signed in on the cookie since) and says so in
 * SESSION_REPLACED_HEADER.
 */
export const END_SESSION_HEADER = "X-Moto-End-Session";
export const SESSION_REPLACED_HEADER = "X-Moto-Session-Replaced";
/**
 * The answer header in which the exit names the marks the request carried
 * (`<name>=<value>, …`): an answer of another session than the tree's wakes
 * the boundary. The session route names its session in the body too
 * (`Session.sessionMark`).
 */
export const PRESENTED_MARK_HEADER = "X-Moto-Presented-Session-Mark";

/** END_SESSION_HEADER for the session of `mark`. */
export function endSessionHeader(portal: PortalKey, mark: string): string {
  return `${portal} ${mark || "-"}`;
}

/** A mark the exit writes: 22 base64url characters. */
const MARK_FORMAT = /^[\w-]{22}$/;

/** `value` if it has the form of a mark, else "": a cookie is any text. */
export function validSessionMark(value: string): string {
  return MARK_FORMAT.test(value) ? value : "";
}

// Marks answers of this tab's own requests wrote (a school switch of its
// guard, a renewal after a second factor): no other tab's change.
const adopted = new Set<string>();
let trackedMark: string | null = null;

/** Records which mark this tab's tree belongs to (the boundary's). */
export function trackOwnSessionMark(name: string): () => void {
  trackedMark = name;
  return () => {
    if (trackedMark === name) trackedMark = null;
  };
}

/** Records the marks an own answer wrote as this tab's own. */
function recordOwnSessionMarks(header: string | null): void {
  if (!header || trackedMark === null) return;
  for (const entry of header.split(",")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === trackedMark) {
      adopted.add(entry.slice(separator + 1).trim());
    }
  }
}

/**
 * Called by the transport for every answer of the tab's own origin, once its
 * headers arrived (#8082): `written` (SESSION_MARK_HEADER) records the marks
 * it wrote as this tab's own, then the boundary compares, before any body.
 * `presented` (PRESENTED_MARK_HEADER) is the mark the request carried, read
 * against the tree's mark from before this answer: another one counts like
 * a reported cookie value (also if a later write put the old one back).
 */
export function noteSessionAnswer(
  written: string | null,
  presented: string | null,
): void {
  if (trackedMark === null) return;
  const before = shownMark;
  recordOwnSessionMarks(written);
  const carried = markIn(presented);
  wake(carried && carried !== before ? carried : undefined);
}

function markIn(header: string | null): string {
  for (const entry of (header ?? "").split(",")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === trackedMark)
      return entry.slice(separator + 1).trim();
  }
  return "";
}

function wake(presented: string | undefined): void {
  for (const listener of ownMarkListeners) listener(presented);
}

const ownMarkListeners = new Set<(presented?: string) => void>();

/**
 * Runs `listener` once an answer of this tab's own named a mark it wrote, or
 * carried another mark than the tree shows.
 */
export function onOwnSessionMark(
  listener: (presented?: string) => void,
): () => void {
  ownMarkListeners.add(listener);
  return () => ownMarkListeners.delete(listener);
}

/**
 * The marks answers of this tab's own wrote since it was last asked; asking
 * forgets them.
 */
export function takeOwnSessionMarks(): ReadonlySet<string> {
  const own = new Set(adopted);
  adopted.clear();
  return own;
}

// The mark of the tree shown (SessionTreeBoundary keeps it).
let shownMark = "";

/** Whether a boundary keeps this document's tree (and its mark). */
export function treeTracked(): boolean {
  return trackedMark !== null;
}

/** Records the mark of the tree shown now. */
export function setShownSessionMark(mark: string): void {
  shownMark = mark;
}

/**
 * The mark of the tree shown now, not the cookie's: an exit of this tree
 * ends only the session it belongs to.
 */
export function shownSessionMark(): string {
  return shownMark;
}

/** The mark this document's cookies hold now; "" without one. */
export function readSessionMark(name: string): string {
  let cookies: string;
  try {
    cookies = document.cookie;
  } catch {
    // Blocked site data: there is no mark to compare.
    return "";
  }
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name)
      return part.slice(separator + 1).trim();
  }
  return "";
}

/**
 * Runs `listener` whenever the browser reports a change of the cookie
 * `name`, where it does (`cookieStore`), with the values the change set
 * ("" for a deletion): a later write may have replaced them by the time the
 * listener reads the cookie. Elsewhere the boundary compares the mark when
 * its tab shows again.
 */
export function onCookieChange(
  name: string,
  listener: (values: readonly string[]) => void,
): () => void {
  const store = (globalThis as { cookieStore?: EventTarget }).cookieStore;
  if (!store) return () => undefined;
  const onChange = (event: Event) => {
    const { changed = [], deleted = [] } = event as Event & {
      changed?: readonly { name?: string; value?: string }[];
      deleted?: readonly { name?: string }[];
    };
    const values = [
      ...changed
        .filter((cookie) => cookie.name === name)
        .map((cookie) => cookie.value ?? ""),
      ...deleted.filter((cookie) => cookie.name === name).map(() => ""),
    ];
    // Another cookie changed: nothing to compare.
    if (values.length > 0) listener(values);
  };
  store.addEventListener("change", onChange);
  return () => store.removeEventListener("change", onChange);
}

/** Only for tests: a fresh document. */
export function _resetSessionMarksForTests(): void {
  adopted.clear();
  shownMark = "";
}
