"use client";

import {
  Activity,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { Session } from "next-auth";
import { getSession, useSession } from "next-auth/react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Loading } from "~/components/ui/loading";
import { ToastSessionScope } from "~/contexts/ToastContext";
import {
  onCookieChange,
  onOwnSessionMark,
  readSessionMark,
  setShownSessionMark,
  takeOwnSessionMarks,
  trackOwnSessionMark,
} from "~/lib/session-mark";
import {
  announceSessionTreeDiscard,
  discardSessionTree,
  hideSessionTree,
  lockSessionTree,
  reloadDocument,
  serverSessionTreeState,
  sessionExitRunning,
  sessionTreeState,
  subscribeSessionTree,
} from "~/lib/session-tree";
import {
  authGeneration,
  confirmSWRSession,
  dropSWRSession,
  useSWRSessionRefresh,
} from "~/lib/swr";

/**
 * How long the boundary waits, after the browser reported a cookie change,
 * to say whether it was this tab's own step (its answer is noted first) or
 * another tab's. The tree is gone at once; only the outcome waits.
 */
const OWN_ANSWER_SETTLE_MS = 250;

export interface SessionTreeLabels {
  /** While the session is being checked. */
  readonly checking: string;
  /** While the document leaves for another session or the logout. */
  readonly leaving: string;
  /** The session cookie changed under this tab. */
  readonly changed: string;
  /** The server could not confirm the session (offline, unreachable). */
  readonly unconfirmed: string;
  readonly reload: string;
  readonly reloadHint: string;
}

const GERMAN_LABELS: SessionTreeLabels = {
  checking: "Anmeldung wird geprüft...",
  leaving: "Seite wird neu geladen...",
  changed:
    "Deine Anmeldung hat sich in einem anderen Tab oder Fenster geändert. Lade die Seite neu, um weiterzuarbeiten.",
  unconfirmed:
    "moto kann gerade nicht prüfen, ob du noch angemeldet bist. Lade die Seite gleich noch einmal.",
  reload: "Seite neu laden",
  reloadHint: "Lädt die Seite mit deiner aktuellen Anmeldung neu.",
};

/**
 * How a document's tree ended: it leaves (an exit navigates, or this tab's
 * own change reloads it), or it waits for the person (another tab's change,
 * or a session the server could not confirm): `Seite neu laden`.
 */
type Ended = "leaving" | "locked" | "unconfirmed";

/**
 * A heartbeat of the document; when it stood still at least this long, the
 * document was suspended (frozen timers), not merely hidden: a hidden tab's
 * timers still run, throttled to about once a minute.
 */
const HEARTBEAT_MS = 15_000;
const SUSPENDED_AFTER_MS = 120_000;

/**
 * The identity a tree shows: the auth generation and whether the school
 * booked the portal. A module the school withdraws or books again is
 * another identity (#8082): the next document shows what the server
 * decides. Null without a session.
 */
function treeIdentity(session: Session | null): string | null {
  const generation = authGeneration(session);
  return generation === null
    ? null
    : `${generation}|${session?.notBooked === true ? "notBooked" : "booked"}`;
}

/**
 * How a changed session ends the tree: this tab's own step (or its exit)
 * leaves; so does a cookie that lost the tree's session (a marked tree's
 * cookie holds no mark any more), since loading shows the login and takes
 * no session over. Another session of another tab waits for the person: no
 * tab switches the shared cookie back and forth by itself.
 */
function endedBy(cookie: string, tree: string, own: boolean): Ended {
  return own || sessionExitRunning() || (cookie === "" && tree !== "")
    ? "leaving"
    : "locked";
}

/**
 * The session boundary of a portal's protected tree (#8082): everything
 * below it, visible pages, pages React or Next keep hidden (`Activity`),
 * parallel slots, overlays and the providers that hold a person's data.
 *
 * A document shows one session. The tree is **confirmed** while the
 * provider's session keeps its identity (the session mark of
 * ~/lib/session-mark and the auth generation of scope.ts: account, school
 * or Träger, preview, roles, permissions); a token rotation, a
 * revalidation and the first mark of a session from before marks keep it.
 * Every event that shows another identity, or leaves it unconfirmed, ends
 * the tree at once and for this document: its DOM, state, drafts, effects,
 * SWR cache, toasts and overlays go, and nothing brings it back. A new
 * document confirms the session on the server. The state table in
 * docs/agents/contracts.md ("Protected tree per session") lists every case;
 * session-tree-boundary.test.tsx runs each row.
 *
 * The server stays the source of truth (#5399): this boundary decides only
 * what this document still shows. Mounted once in every portal, inside the
 * SessionProvider and after the session components that draw nothing.
 */
export function SessionTreeBoundary({
  sessionMark,
  labels = GERMAN_LABELS,
  endedSessionUrl,
  children,
}: Readonly<{
  /** The portal (kept for the call sites; a document shows one). */
  portal: string;
  /** The portal's session mark and the one the page was rendered with. */
  sessionMark: { readonly name: string; readonly rendered: string };
  labels?: SessionTreeLabels;
  /**
   * Where a session the server ended (expired, revoked) leads: the portal's
   * login with its notice. Without one, the document loads anew.
   */
  endedSessionUrl?: () => string;
  children: React.ReactNode;
}>) {
  const { data: session, status } = useSession();
  const { pending, signedOut, revision } = useSWRSessionRefresh();
  const tree = useSyncExternalStore(
    subscribeSessionTree,
    sessionTreeState,
    serverSessionTreeState,
  );
  const [ended, setEnded] = useState<Ended | null>(null);
  // A cookie value the tree does not have, until the boundary decided whose.
  const [deciding, setDeciding] = useState(false);
  // After a freeze, until the server confirmed the session (onResume).
  const [shielded, setShielded] = useState(false);

  // The identity the tree shows: undefined before the provider's first
  // answer, null without a session. Derived in render, so the tree never
  // renders with another one.
  const generation = status === "loading" ? undefined : treeIdentity(session);
  const [shownGeneration, setShownGeneration] = useState(generation);
  if (generation !== undefined && shownGeneration === undefined)
    setShownGeneration(generation);
  // Another identity: a sign-in on a page without a session takes it; any
  // other change ends the tree (this tab's own exit navigates, anything
  // else loads the document anew). Another tab of this origin that bound a
  // new owner (`pending`) ends it until the person loads again, or, when
  // that tab signed out, loads the login.
  const changedGeneration =
    generation !== undefined &&
    shownGeneration !== undefined &&
    generation !== shownGeneration &&
    shownGeneration !== null;
  if (
    generation !== undefined &&
    shownGeneration === null &&
    generation !== null
  )
    setShownGeneration(generation);
  // The mark the tree belongs to: the rendered one, then its own sign-in's
  // or the first mark of a session from before marks.
  const markOfTree = useRef(sessionMark.rendered);
  // Another tab's change waits for the person, also when this tab's provider
  // learned it first (the cookie holds another mark): no tab switches the
  // shared cookie back and forth by itself.
  const endedNow: Ended | null =
    ended ??
    (tree.locked
      ? tree.locked === "unconfirmed"
        ? "unconfirmed"
        : "locked"
      : pending && !signedOut
        ? endedBy(readSessionMark(sessionMark.name), markOfTree.current, false)
        : // Another tab that cleared the owner (a signout, or a tab whose
          // lookup failed) leaves the decision to the server (`checkSignout`,
          // below), unless the provider answers another identity first.
          changedGeneration
          ? // No answer while the cookie still holds the tree's session: the
            // provider's lookup failed (Auth.js answers null then), nothing
            // is proven.
            session === null &&
            !sessionExitRunning() &&
            readSessionMark(sessionMark.name) === markOfTree.current
            ? "unconfirmed"
            : // The cookie still holds the tree's mark: its own claims
              // changed, or the server ended the session.
              readSessionMark(sessionMark.name) === markOfTree.current
              ? "leaving"
              : endedBy(
                  readSessionMark(sessionMark.name),
                  markOfTree.current,
                  false,
                )
          : null);
  if (endedNow !== ended) setEnded(endedNow);
  // A session the server answered as ended (its read, or the provider's)
  // leads to the portal's login with its notice instead of a reload.
  const sessionEnded = useRef(false);
  const latest = useRef({
    status,
    session,
    ended: endedNow,
    ownerCleared: pending && signedOut,
  });
  // Another tab cleared the owner: the tree hides until the server answers
  // whether this session lives on (that tab's lookup failed) or ended (it
  // signed out).
  const checkSignout = useRef<() => void>(() => undefined);
  // A later render of the layout (a router refresh) names the mark its
  // server saw: another one than the tree's counts like a reported cookie
  // value (#8082).
  const noteRenderedMark = useRef<(mark: string) => void>(() => undefined);
  const firstRendered = useRef(sessionMark.rendered);
  useEffect(() => {
    if (sessionMark.rendered === firstRendered.current) return;
    firstRendered.current = sessionMark.rendered;
    noteRenderedMark.current(sessionMark.rendered);
  }, [sessionMark.rendered]);
  useEffect(() => {
    if (pending && signedOut) checkSignout.current();
  }, [pending, signedOut, revision]);
  useLayoutEffect(() => {
    latest.current = {
      status,
      session,
      ended: endedNow,
      ownerCleared: pending && signedOut,
    };
  });

  // An ended tree drops its cache and toasts once; a tree that leaves
  // without an exit of its own loads the document anew.
  const endedOnce = useRef(false);
  useEffect(() => {
    if (!endedNow || endedOnce.current) return;
    endedOnce.current = true;
    dropSWRSession();
    if (endedNow !== "leaving") {
      // Also for a boundary this document mounts later.
      lockSessionTree(endedNow === "unconfirmed" ? "unconfirmed" : "changed");
      announceSessionTreeDiscard();
      return;
    }
    const reload = !sessionExitRunning() && !tree.leaving;
    // The document leaves: an exit that fails after this loads it anew
    // (`sessionTreeState().leaving`), it never shows the tree again.
    discardSessionTree();
    if (!reload) return;
    if (
      (sessionEnded.current || latest.current.session?.error !== undefined) &&
      endedSessionUrl
    )
      globalThis.location.assign(endedSessionUrl());
    else reloadDocument();
  }, [endedNow, tree.leaving, endedSessionUrl]);

  useEffect(() => {
    const signedIn = () => latest.current.status !== "unauthenticated";
    const end = (kind: Ended) => {
      if (latest.current.ended) return;
      setEnded(kind);
    };
    // `seen`: values a cookie change event set, also those a later write
    // replaced before this compares (another tab's switch, then a late
    // rotation of the old family), and marks answers carried.
    const compare = (seen: readonly string[] = []) => {
      if (latest.current.ended || sessionTreeState().leaving) return;
      const own = takeOwnSessionMarks();
      // This tab's own answer deleted the session (also one without a mark).
      if (own.has("") && signedIn()) return end("leaving");
      // A first mark taken below: the server confirms it once every other
      // value seen was compared too.
      let tookFirstMark = false;
      // Marks this tab's own answers wrote count too: a late write may have
      // restored the tree's mark in the cookie since.
      for (const mark of [...seen, ...own, readSessionMark(sessionMark.name)]) {
        if (mark === markOfTree.current) continue;
        if (own.has(mark) && !signedIn()) {
          // A page without a session takes its own sign-in's mark.
          markOfTree.current = mark;
          setShownSessionMark(mark);
          continue;
        }
        if (own.has(mark) && markOfTree.current === "") {
          // A session from before marks takes its first one only as the
          // same identity: the tree hides until the server confirms it (a
          // staff preview's first mark is another identity).
          markOfTree.current = mark;
          setShownSessionMark(mark);
          tookFirstMark = true;
          continue;
        }
        // A page without a session takes no other tab's mark either.
        if (!signedIn()) continue;
        // This tab's own step to another session leaves (its exit
        // navigates, or the document loads anew); another tab's change
        // waits for the person, its signout loads the login.
        return end(
          endedBy(
            readSessionMark(sessionMark.name),
            markOfTree.current,
            own.has(mark),
          ),
        );
      }
      if (tookFirstMark) check();
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    let seen: string[] = [];
    const compareSeen = () => {
      clearTimeout(settle);
      settle = undefined;
      const values = seen;
      seen = [];
      compare(values);
      setDeciding(false);
    };
    const onCookieChanged = (values: readonly string[]) => {
      // The tree hides at once; whose change it was is decided once this
      // tab's own answer had its chance to be noted, and every outcome but
      // the same session ends it.
      if (values.some((value) => value !== markOfTree.current))
        setDeciding(true);
      seen.push(...values);
      settle ??= setTimeout(compareSeen, OWN_ANSWER_SETTLE_MS);
    };
    const onFocus = () => compareSeen();
    // A suspended document: browsers without the `resume` event (Safari,
    // Firefox) wake it with `visibilitychange` alone. Its stopped heartbeat
    // tells it from a tab that was merely hidden, which returns at once.
    let lastBeat = Date.now();
    const heartbeat = setInterval(() => {
      lastBeat = Date.now();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      compareSeen();
      const suspended = Date.now() - lastBeat >= SUSPENDED_AFTER_MS;
      lastBeat = Date.now();
      if (suspended) check();
    };
    const onPageHide = () => {
      // Synchronously, before the browser keeps the page: no protected DOM
      // goes into the back-forward cache.
      flushSync(() => discardSessionTree());
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // A restored page asks the server again. So does a page that shows
      // again after its own pagehide without leaving: its tree is gone.
      if (event.persisted || sessionTreeState().leaving) reloadDocument();
    };
    // One check by the server: the tree stays hidden, with its drafts, and
    // toasts go; a direct read of the session route (the provider keeps its
    // state, no other tab wakes) shows it again only for the same identity
    // Identity & Access confirmed. Another one leaves; no confirmation
    // waits for the person.
    let reads = 0;
    function check() {
      if (latest.current.ended || !signedIn() || sessionTreeState().leaving)
        return;
      const read = ++reads;
      const target = markOfTree.current;
      const shown = latest.current.session;
      hideSessionTree();
      setShielded(true);
      void getSession({ broadcast: false })
        .catch(() => undefined)
        .then((answer) => {
          if (latest.current.ended) return;
          // Every read that proves a change ends the tree, also one a later
          // read overtook; only the latest read may show it again.
          const latestRead = read === reads;
          // No session any more (no answer, and the cookie holds none), or
          // one the server answers as ended: the document loads the login.
          // No answer with the cookie in place may be a failed request.
          if (
            answer === null &&
            target !== "" &&
            readSessionMark(sessionMark.name) === ""
          )
            return end("leaving");
          if (answer?.error !== undefined) {
            sessionEnded.current = true;
            return end("leaving");
          }
          if (
            answer &&
            answer.sessionConfirmed === true &&
            ((answer.sessionMark ?? "") !== target ||
              treeIdentity(answer) !== treeIdentity(shown))
          )
            return end("leaving");
          // Unreadable or unconfirmed, also a read a later one overtook:
          // nothing proves the session, the person loads again.
          if (!answer || answer.sessionConfirmed !== true)
            return end("unconfirmed");
          if (!latestRead) return;
          setShielded(false);
          compareSeen();
          // Another tab cleared the owner, and the server confirmed this
          // session: its reads go on (the provider's own confirmation does
          // not accept the same account and school after a cleared owner).
          if (latest.current.ownerCleared && !latest.current.ended)
            confirmSWRSession();
        });
    }
    // A frozen document asks the server before it shows the tree again.
    const onResume = () => {
      lastBeat = Date.now();
      compareSeen();
      check();
    };
    checkSignout.current = check;
    noteRenderedMark.current = (mark) => {
      seen.push(mark);
      compareSeen();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    // From now this pagehide drops the tree; the inline check's body removal
    // ends. Not earlier: a pagehide in between would find neither.
    document.documentElement.dataset.sessionTreeHydrated = "";
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("resume", onResume);
    const stopCookieChanges = onCookieChange(sessionMark.name, onCookieChanged);
    // Every answer of this tab's own origin: its headers arrived (the marks
    // it wrote, the mark it carried), compared before any body.
    const stopOwnMarks = onOwnSessionMark((presented) => {
      if (presented !== undefined) seen.push(presented);
      compareSeen();
    });
    // A change the browser reported before this listener existed (after the
    // initial check below) is compared now.
    compareSeen();
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("resume", onResume);
      clearInterval(heartbeat);
      clearTimeout(settle);
      stopCookieChanges();
      stopOwnMarks();
    };
  }, [sessionMark.name]);

  // From the first commit: an answer of this tab's own that arrives before
  // the listeners above exist still counts as its own.
  useLayoutEffect(
    () => trackOwnSessionMark(sessionMark.name),
    [sessionMark.name],
  );

  // Check before the first paint, both after hydration and when a router
  // Activity reconnects this boundary's effects after hiding it.
  useLayoutEffect(() => {
    const now = readSessionMark(sessionMark.name);
    const root = document.documentElement;
    // The value the inline check saw before hydration: another session then
    // is evidence, also if a late write restored the rendered mark since.
    const seen = root.getAttribute("data-session-mark-seen");
    if (
      (now !== markOfTree.current ||
        (seen !== null && seen !== markOfTree.current)) &&
      latest.current.status !== "unauthenticated"
    ) {
      setEnded(endedBy(now, markOfTree.current, false));
    } else {
      markOfTree.current = now;
      setShownSessionMark(now);
    }
    delete root.dataset.sessionMarkStale;
    root.removeAttribute("data-session-mark-seen");
  }, [sessionMark.name]);

  if (tree.leaving || endedNow === "leaving") {
    return <Loading fullPage message={labels.leaving} />;
  }
  if (endedNow === "locked" || endedNow === "unconfirmed") {
    return (
      <div className="mx-auto flex min-h-[200px] max-w-3xl items-center p-4">
        <div className="w-full space-y-3">
          {endedNow === "locked" ? (
            <Alert type="info" message={labels.changed} />
          ) : (
            <Alert type="warning" message={labels.unconfirmed} />
          )}
          <Button
            type="button"
            size="md"
            onClick={reloadDocument}
            tooltip={labels.reloadHint}
          >
            {labels.reload}
          </Button>
        </div>
      </div>
    );
  }
  // Hidden, not gone, until the server or the decision answered: only the
  // same identity shows it again.
  const hidden = shielded || deciding;
  return (
    <>
      {/* Runs while the server's HTML is parsed, before it paints: a cookie
          that changed since the page was rendered hides it until the
          hydrated boundary decides. Executed only from the server's HTML. */}
      <script
        dangerouslySetInnerHTML={{
          __html: staleMarkScript(sessionMark.name, sessionMark.rendered),
        }}
      />
      {hidden ? <Loading fullPage message={labels.checking} /> : null}
      <Activity mode={hidden ? "hidden" : "visible"}>
        <ToastSessionScope>{children}</ToastSessionScope>
      </Activity>
    </>
  );
}

/**
 * The inline check of the server's HTML, before it paints and before the
 * boundary hydrates: compares the cookie's session mark with the one the page
 * was rendered with and marks the document stale
 * (`html[data-session-mark-stale]`, hidden in globals.css) on a difference,
 * keeping the value it saw (`data-session-mark-seen`) as evidence for the
 * boundary, also if a later write puts the rendered mark back.
 * It also covers a page that leaves before it hydrated: on `pagehide` its
 * server-rendered body goes (the hydrated boundary drops its tree itself),
 * and the back-forward cache's copy loads again when it is restored.
 */
export function staleMarkScript(name: string, rendered: string): string {
  // JSON in a script element: `<` cannot close it. The rendered mark has the
  // mark's own form already (readRenderedSessionMark).
  const literal = (value: string) =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  return `(function(){try{var d=document.documentElement,n=${literal(name)},r=${literal(rendered)},v="";document.cookie.split(";").forEach(function(p){var i=p.indexOf("=");if(i>0&&p.slice(0,i).trim()===n)v=p.slice(i+1).trim();});if(v!==r){d.setAttribute("data-session-mark-stale","");d.setAttribute("data-session-mark-seen",v);}var c=0;addEventListener("pagehide",function(){d.setAttribute("data-session-mark-stale","");if(!d.hasAttribute("data-session-tree-hydrated")&&document.body){document.body.replaceChildren();c=1;}});addEventListener("pageshow",function(e){if(e.persisted||c)location.reload();});}catch(e){}})();`;
}

/**
 * The first look at the session mark after hydration, before the session
 * components that write personal storage (PersonalStorageGuard): a page whose
 * cookie changed since it was rendered marks the document stale, so none of
 * them binds the old owner; SessionTreeBoundary then decides.
 */
export function StaleSessionMarkCheck({
  sessionMark,
}: Readonly<{
  sessionMark: { readonly name: string; readonly rendered: string };
}>) {
  // Once, at hydration: the boundary clears the flag only then. A later
  // render of the layout (a soft refresh) leaves the decision to the
  // boundary, which compares with the tree's own mark.
  const checked = useRef(false);
  useLayoutEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (readSessionMark(sessionMark.name) !== sessionMark.rendered)
      document.documentElement.setAttribute("data-session-mark-stale", "");
  }, [sessionMark.name, sessionMark.rendered]);
  return null;
}
