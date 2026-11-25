import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import {
  getModifiedCookieValues,
  type ResponseCookies,
} from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { env } from "~/env";
import {
  approveSessionCookieWrites,
  isSessionCookieName,
  isWrittenSessionCookieName,
  tenantSessionCookieName,
} from "~/lib/session-cookie-exit.server";
import {
  END_SESSION_HEADER,
  PRESENTED_MARK_HEADER,
  SESSION_MARK_HEADER,
  SESSION_REPLACED_HEADER,
  sessionMarkName,
} from "~/lib/session-mark";
import { decodeJwtPayload } from "./jwt-payload";
import { PORTALS, portalOfScope } from "./portals";
import {
  familyBacksSession,
  sessionFamilyState,
  type SessionFamilyState,
} from "./token-validation";

/**
 * The one exit of every session cookie of every portal (#5399). Auth.js
 * re-encodes the session cookie on every session read, and a response that
 * arrives after a logout or a school switch deleted or replaced the cookie
 * wrote the old session back. See gateSessionCookieWrites; the lock in
 * lib/session-cookie-exit.server.ts drops every session cookie write it did not approve
 * (#5520), and the inventory in session-cookie-inventory.test.ts keeps the
 * known writers on this path.
 */

export { isSessionCookieName };

/** A session cookie or chunk the gate decides on, as before #5520. */
function isGatedSessionCookie(name: string): boolean {
  return /session-token(?:\.\d+)?$/.test(name);
}

/** Set-Cookie headers of the backend without a BFF session cookie. */
export function withoutSessionCookies(setCookies: string[]): string[] {
  return setCookies.filter(
    (cookie) =>
      !isSessionCookieName(cookie.slice(0, cookie.indexOf("=")).trim()),
  );
}

/**
 * Takes the session cookies out of Next's mutable cookie jar of this request
 * and returns them as Set-Cookie headers. Auth.js' server helpers (signIn,
 * unstable_update) write there, and Next appends the jar to a route's
 * response after the route returned (appendMutableCookies), past every gate.
 * Outside a request there is no jar.
 */
export async function takeJarSessionCookies(): Promise<string[]> {
  let jar: ResponseCookies | null;
  try {
    jar = (await cookies()) as unknown as ResponseCookies | null;
  } catch {
    return [];
  }
  if (!jar) return [];
  // Next hands out its own list of pending writes, not a copy.
  const pending = getModifiedCookieValues(jar);
  const taken = pending.filter((cookie) => isSessionCookieName(cookie.name));
  for (const cookie of taken) pending.splice(pending.indexOf(cookie), 1);
  if (
    getModifiedCookieValues(jar).some((cookie) =>
      isSessionCookieName(cookie.name),
    )
  )
    throw new Error("Session cookies stay in the Next cookie jar");
  // The pinned Next adapter keeps the options that cookies().getAll() omits.
  const serialized = new NextResponse(null);
  for (const cookie of taken) serialized.cookies.set(cookie);
  return serialized.headers.getSetCookie();
}
/** Claims Auth.js sets on every encode; they change on every write. */
const ENCODE_CLAIMS = new Set(["iat", "exp", "jti"]);

interface CookieWrite {
  name: string;
  value: string;
  deletes: boolean;
}

function parseSetCookie(header: string): CookieWrite | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  const deletes =
    value === "" ||
    attributes.some((attribute) => {
      const [key, raw] = attribute.split("=", 2).map((part) => part.trim());
      if (key?.toLowerCase() === "max-age") return Number(raw) <= 0;
      if (key?.toLowerCase() === "expires")
        return Date.parse(raw ?? "") <= Date.now();
      return false;
    });
  return { name, value, deletes };
}

/** `name` or one of its chunks `name.0`, `name.1`, … */
function chunkIndex(cookie: string, base: string): number | null {
  if (cookie === base) return 0;
  if (!cookie.startsWith(`${base}.`)) return null;
  const suffix = cookie.slice(base.length + 1);
  return /^\d+$/.test(suffix) ? Number(suffix) : null;
}

function baseName(cookie: string): string {
  return cookie.replace(/\.\d+$/, "");
}

/** Auth.js' SessionStore joins the chunks in index order. */
function joinChunks(cookies: Iterable<[string, string]>, base: string) {
  const chunks: [number, string][] = [];
  for (const [name, value] of cookies) {
    const index = chunkIndex(name, base);
    if (index !== null) chunks.push([index, value]);
  }
  if (!chunks.length) return null;
  return chunks
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value)
    .join("");
}

function requestCookies(request: Request): [string, string][] {
  const header = request.headers.get("cookie");
  if (!header) return [];
  return header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return [];
    return [
      [part.slice(0, separator).trim(), part.slice(separator + 1).trim()],
    ];
  });
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, entry]) => !ENCODE_CLAIMS.has(key) && entry !== undefined,
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

async function readSession(token: string, salt: string) {
  try {
    return (await decode({
      token,
      salt,
      secret: env.NEXTAUTH_SECRET,
    })) as Record<string, unknown> | null;
  } catch {
    // Not a session Auth.js can read back either: it carries no session.
    return null;
  }
}

/** The family state per access token, asked once per response. */
export type FamilyStates = Map<string, Promise<SessionFamilyState>>;

export function familyStateOf(
  states: FamilyStates,
  session: Record<string, unknown>,
): Promise<SessionFamilyState> {
  const token = typeof session.token === "string" ? session.token : "";
  let state = states.get(token);
  if (!state) {
    state = sessionFamilyState(token, portalOfScope(session.scope).validation);
    states.set(token, state);
  }
  return state;
}

/** Whether a written session may reach the browser (#5399). */
async function mayWrite(
  written: Record<string, unknown> | null,
  presented: Record<string, unknown> | null,
  states: FamilyStates,
): Promise<boolean> {
  // Auth.js cannot read it back either; it carries no session.
  if (!written) return true;
  // A mere re-encoding of the presented session.
  if (
    presented &&
    JSON.stringify(stable(written)) === JSON.stringify(stable(presented))
  )
    return false;
  // An ended session: the response body reports the end; the cookie stays
  // as the browser holds it, possibly already deleted or replaced.
  if (written.error || typeof written.token !== "string" || !written.token)
    return false;
  // A new or renewed session only while its family is live, asked now.
  const state = await familyStateOf(states, written);
  if (familyBacksSession(state)) return true;
  // Without an answer, a refresh token this request was just issued (sign-in
  // or rotation) still lands: Identity & Access issues one only for a live
  // family, and dropping it would leave the browser on the consumed token
  // once the recovery grace ended. A family answered as revoked never lands.
  return (
    state === "unknown" &&
    typeof written.refreshToken === "string" &&
    written.refreshToken !== presented?.refreshToken
  );
}

/**
 * The server invariant of #5399, for every session cookie of every portal: a
 * response writes one only for a session that changed (sign-in, rotation,
 * update(), replacement) and whose refresh-token family Identity & Access
 * does not answer as revoked while the response is built. A re-encoded
 * unchanged session, an ended one and one of a revoked family set nothing,
 * whenever the request started and however late its answer arrives. Cleanup
 * deletions are dropped with a refused replacement so the browser keeps its
 * existing session intact. Standalone deletions and every other cookie pass
 * unchanged.
 *
 * The one exit: Auth.js' own routes (withBrowserSession) and every BFF route
 * (finishResponse) leave through here. The session cookies still waiting in
 * Next's cookie jar join the response's own, ordered as Next would merge
 * them (jar first, the response's own win), and leave only through here.
 */
export async function gateSessionCookieWrites(
  request: Request,
  response: Response,
  states: FamilyStates = new Map(),
): Promise<Response> {
  const own = response.headers.getSetCookie();
  const ownNames = new Set(own.map((cookie) => parseSetCookie(cookie)?.name));
  const fromJar = (await takeJarSessionCookies()).filter(
    (cookie) => !ownNames.has(parseSetCookie(cookie)?.name),
  );
  const replaced = endsAnotherSession(request);
  // Which session this answer describes, for the tab that asked: the one
  // an error of it belongs to, also after another tab changed the cookie.
  const described = presentedMarkHeader(request);
  const setCookies = [...fromJar, ...own].filter(
    (cookie) => !replaced || !isSessionDeletion(cookie),
  );
  const allowed = await allowedSetCookies(request, setCookies, states);
  const marks = await sessionMarkWrites(allowed);
  allowed.push(...marks.map(({ cookie }) => cookie));
  // A mark this request changed (sign-in, school switch, a second factor,
  // logout): the asking tab's own step. A rotation within the family it
  // presented changes none, also not one another tab's login brought.
  const presentedMarks = new Map(requestCookies(request));
  // A deletion is always this tab's own step, also of a session without a
  // mark (empty to empty): its tree goes at the answer's headers.
  const changed = marks.filter(
    ({ name, value }) => !value || (presentedMarks.get(name) ?? "") !== value,
  );
  // The lock at the server's exit lets only these session cookie writes go
  // (#5520); a write that bypasses this gate is dropped there.
  approveSessionCookieWrites(
    allowed.filter((cookie) => {
      const write = parseSetCookie(cookie);
      // Only names Auth.js writes: another name a reader takes for the
      // session (`parent.session-token.evil`) never gets past the exit.
      return write && isWrittenSessionCookieName(write.name) && !write.deletes;
    }),
  );
  if (
    !replaced &&
    !described &&
    !fromJar.length &&
    !marks.length &&
    allowed.length === own.length
  )
    return response;

  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  for (const cookie of allowed) headers.append("Set-Cookie", cookie);
  // The marks this request changed, readable by the tab that asked: its own
  // session step, never another tab's change (#8082, ~/lib/session-mark).
  if (changed.length)
    headers.set(
      SESSION_MARK_HEADER,
      changed.map(({ name, value }) => `${name}=${value}`).join(", "),
    );
  if (replaced) headers.set(SESSION_REPLACED_HEADER, "1");
  if (described) headers.set(PRESENTED_MARK_HEADER, described);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A deletion of a session cookie or one of its chunks. */
function isSessionDeletion(cookie: string): boolean {
  const write = parseSetCookie(cookie);
  return write !== null && write.deletes && isGatedSessionCookie(write.name);
}

/**
 * Whether this request would end another session than the one its exit
 * names (END_SESSION_HEADER, #8082): another tab signed in on the cookie
 * since, before the request left. The request carries the cookies the
 * browser deletes with its answer (and whose family a logout revokes), the
 * session's mark among them; the exit named the mark the cookie held for
 * its session. A request without the header names nothing.
 */
export function endsAnotherSession(request: Request): boolean {
  const [portal, named] = (request.headers.get(END_SESSION_HEADER) ?? "")
    .trim()
    .split(/\s+/);
  if (!portal || named === undefined) return false;
  const presented = new Map(requestCookies(request));
  const mark = sessionMarks().find(({ key }) => key === portal)?.name;
  if (!mark) return false;
  return (presented.get(mark) || "-") !== named;
}

/** The mark the request carried for `portal`'s session; "" without one. */
export function presentedSessionMark(
  request: Request,
  portal: keyof typeof PORTALS,
): string {
  const mark = sessionMarks().find(({ key }) => key === portal)?.name;
  return (mark && new Map(requestCookies(request)).get(mark)) || "";
}

/** The marks the request carried, as PRESENTED_MARK_HEADER names them. */
function presentedMarkHeader(request: Request): string {
  const presented = new Map(requestCookies(request));
  return [...new Set(sessionMarks().map(({ name }) => name))]
    .flatMap((name) => {
      const value = presented.get(name);
      return value ? [`${name}=${value}`] : [];
    })
    .join(", ");
}

async function allowedSetCookies(
  request: Request,
  setCookies: string[],
  states: FamilyStates,
): Promise<string[]> {
  const writes = setCookies.map(parseSetCookie);
  const bases = new Set(
    writes
      .filter((write): write is CookieWrite => write !== null)
      .filter((write) => isGatedSessionCookie(write.name))
      .map((write) => baseName(write.name)),
  );
  if (!bases.size) return setCookies;

  const presented = requestCookies(request);
  const refused = new Set<string>();
  for (const base of bases) {
    const own = writes.filter(
      (write): write is CookieWrite =>
        write !== null && chunkIndex(write.name, base) !== null,
    );
    // Auth.js cleans obsolete chunks alongside replacements. Only the final
    // non-deleted values form the session to validate; cleanup is not a bypass.
    const latest = new Map<string, string>();
    for (const write of own) {
      if (write.deletes) latest.delete(write.name);
      else latest.set(write.name, write.value);
    }
    if (!latest.size) continue;
    const written = joinChunks(latest, base);
    const before = joinChunks(presented, base);
    const [next, previous] = await Promise.all([
      written ? readSession(written, base) : null,
      before ? readSession(before, base) : null,
    ]);
    if (!(await mayWrite(next, previous, states))) refused.add(base);
  }
  return setCookies.filter((_, index) => {
    const write = writes[index];
    return !write || !refused.has(baseName(write.name));
  });
}

/**
 * The mark of a session: its refresh-token family and, for a staff preview,
 * the preview (it keeps the admin's family). Null without a family.
 */
function sessionMarkOf(session: Record<string, unknown> | null): string | null {
  const token = typeof session?.token === "string" ? session.token : "";
  const claims = decodeJwtPayload(token);
  const family = claims?.family_id;
  if (typeof family !== "string" || !family) return null;
  const preview =
    typeof claims?.preview_id === "string" ? claims.preview_id : "";
  return createHmac("sha256", env.NEXTAUTH_SECRET)
    .update(`session-mark:${family}:${preview}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Each portal's session cookie with its mark (~/lib/session-mark). */
function sessionMarks() {
  return (Object.keys(PORTALS) as (keyof typeof PORTALS)[]).flatMap((key) => {
    const name = sessionMarkName(key, env.TENANT_DOMAIN);
    const domain = PORTALS[key].cookieNames?.domain;
    const base =
      key === "tenant"
        ? tenantSessionCookieName(env.TENANT_DOMAIN)
        : (PORTALS[key].cookieNames?.session ?? `${key}.session-token`);
    // Auth.js' default name (the tenant on localhost) takes `__Secure-` on https.
    const bases = PORTALS[key].cookieNames
      ? [base]
      : [base, `__Secure-${base}`];
    return bases.map((variant) => ({ key, base: variant, name, domain }));
  });
}

/**
 * The session marks that go with the session cookies this response leaves
 * with (#8082, ~/lib/session-mark): the mark of the session it writes, also
 * when the request presented the same one (a late answer may write back an
 * older session than the cookie holds now), or its deletion with the session.
 */
async function sessionMarkWrites(
  setCookies: string[],
): Promise<{ name: string; value: string; cookie: string }[]> {
  const parsed = setCookies.map(parseSetCookie);
  const marks: { name: string; value: string; cookie: string }[] = [];
  for (const { base, name, domain } of sessionMarks()) {
    const writes = parsed.filter(
      (write): write is CookieWrite =>
        write !== null && chunkIndex(write.name, base) !== null,
    );
    if (!writes.length) continue;
    const latest = new Map<string, string>();
    for (const write of writes) {
      if (write.deletes) latest.delete(write.name);
      else latest.set(write.name, write.value);
    }
    const written = latest.size ? joinChunks(latest, base) : null;
    // A deletion ends the session only with its first chunk; deleting a
    // leftover chunk beside a kept session is a cleanup.
    if (
      !written &&
      !writes.some(
        (write) => write.deletes && chunkIndex(write.name, base) === 0,
      )
    )
      continue;
    const mark = written
      ? sessionMarkOf(await readSession(written, base))
      : null;
    // A session without a family (from before families) carries no mark.
    if (written && !mark) continue;
    const attributes = [
      "Path=/",
      "SameSite=Lax",
      ...(domain ? [`Domain=${domain}`] : []),
      ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
    ];
    // As long as the session cookie: a browser restart keeps both or none.
    const lifetime =
      setCookies
        .filter((_, index) => {
          const write = parsed[index];
          return (
            write && !write.deletes && chunkIndex(write.name, base) !== null
          );
        })
        .at(-1)
        ?.split(";")
        .slice(1)
        .map((attribute) => attribute.trim())
        .filter((attribute) => /^(expires|max-age)=/i.test(attribute)) ?? [];
    marks.push({
      name,
      value: mark ?? "",
      cookie: mark
        ? [`${name}=${mark}`, ...lifetime, ...attributes].join("; ")
        : [`${name}=`, "Max-Age=0", ...attributes].join("; "),
    });
  }
  return marks;
}
