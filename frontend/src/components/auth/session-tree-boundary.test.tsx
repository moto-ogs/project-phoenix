import {
  Activity,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

/**
 * The portal's session boundary (#8082) with a real Activity subtree, real
 * SWR and the real SWRScopeBoundary: a synthetic record and a draft on a
 * route that React keeps hidden must leave the DOM at every session change,
 * late answers must not bring them back, and an unchanged session keeps them.
 */

vi.unmock("swr");

const { sessionStore, sessionLookup, getSession, mockAnnounce, mockReload } =
  vi.hoisted(() => {
    type Value = { data: unknown; status: string };
    // The session the server answers: the store's, named with the mark its
    // cookie holds now (`Session.sessionMark`), or none (`lookup.fails`).
    const cookieMark = () =>
      /(?:^|; )authjs\.session-mark=([^;]*)/.exec(document.cookie)?.[1] ?? "";
    // `held`: lookups wait until the test releases them.
    const lookup = {
      fails: false,
      // The server answers the session as ended (its family revoked).
      ended: false,
      // Fields one lookup answers on top, in the order lookups start.
      queue: [] as Record<string, unknown>[],
      held: null as Promise<void> | null,
      // Other claims the server answers (a rights change it reports).
      claims: null as Record<string, unknown> | null,
    };
    const answer = () =>
      lookup.fails || value.data === null
        ? null
        : {
            ...(value.data as object),
            ...(lookup.ended ? { error: "RefreshTokenError" } : {}),
            ...(lookup.claims
              ? {
                  user: {
                    ...(value.data as { user: object }).user,
                    ...lookup.claims,
                  },
                }
              : {}),
            sessionMark: cookieMark(),
            ...(lookup.ended ? {} : { sessionConfirmed: true }),
          };
    // useSession's update(): the provider reads the session again.
    const update = async () => {
      if (lookup.held) {
        // Auth.js keeps the old answer while it loads.
        value = { ...value, status: "loading" };
        for (const listener of listeners) listener();
        await lookup.held;
      }
      const next = answer();
      value =
        next !== null
          ? { ...value, data: next, status: "authenticated" }
          : {
              ...value,
              status: value.data === null ? "unauthenticated" : "authenticated",
            };
      for (const listener of listeners) listener();
      return next;
    };
    let value: Value & { update: typeof update } = {
      data: null,
      status: "unauthenticated",
      update,
    };
    const listeners = new Set<() => void>();
    return {
      sessionStore: {
        get: () => value,
        set: (next: Value) => {
          value = { ...next, update };
          for (const listener of listeners) listener();
        },
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      sessionLookup: lookup,
      getSession: async () => {
        const extra = lookup.queue.shift();
        if (lookup.held) await lookup.held;
        const value = answer();
        return value && extra ? { ...value, ...extra } : value;
      },
      mockAnnounce: vi.fn(),
      mockReload: vi.fn(),
    };
  });

vi.mock("next-auth/react", () => ({
  getSession,
  useSession: () =>
    useSyncExternalStore(
      sessionStore.subscribe,
      sessionStore.get,
      sessionStore.get,
    ),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));
vi.mock("~/lib/session-cache", () => ({
  announceSessionChange: mockAnnounce,
}));
vi.mock("~/lib/session-tree", async (original) => ({
  ...(await original<typeof import("~/lib/session-tree")>()),
  reloadDocument: mockReload,
}));

import {
  SessionTreeBoundary,
  StaleSessionMarkCheck,
  staleMarkScript,
} from "./session-tree-boundary";
import {
  _resetSessionTreeForTests,
  announceSessionTreeDiscard,
  beginSessionExit,
  discardSessionTree,
  onSessionTreeDiscard,
  sessionTreeState,
} from "~/lib/session-tree";
import { SWRScopeBoundary, useSWRAuth, useSWRPreload } from "~/lib/swr";
import {
  _resetSessionMarksForTests,
  noteSessionAnswer,
  readSessionMark,
  shownSessionMark,
} from "~/lib/session-mark";
import { useTenantMutate } from "~/lib/swr/hooks";
import { setTestClock } from "~/test/clock";
import { SWRServerSeed, type ServerSeed } from "~/lib/swr/server-seed";
import { useSWRConfig } from "~/lib/swr/testing";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { personalStorageOwner } from "~/lib/personal-storage";
import {
  ToastProvider,
  ToastSessionScope,
  useToast,
} from "~/contexts/ToastContext";
import {
  isSWRSessionPending,
  resetSWRScope,
  resumeSWRSession,
  suspendSWRSession,
} from "~/lib/swr/scope";

type User = Session["user"];

function session(user: Partial<User> = {}): Session {
  return {
    user: {
      id: "7",
      name: "Synthetische Person",
      email: "person@example.invalid",
      scope: "",
      tenantId: "42",
      roles: ["user"],
      permissions: ["students:read"],
      ...user,
    } as User,
    expires: "2099-01-01",
  };
}

function signIn(value: Session) {
  act(() => sessionStore.set({ data: value, status: "authenticated" }));
}

function signOut() {
  act(() => sessionStore.set({ data: null, status: "unauthenticated" }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Every request of the synthetic pages, in order; each answers when told.
let reads: Array<ReturnType<typeof deferred<string>>> = [];
let writes: Array<ReturnType<typeof deferred<void>>> = [];
const readRecord = () => {
  const request = deferred<string>();
  reads.push(request);
  return request.promise;
};

function RecordPage() {
  const { data } = useSWRAuth("child-record", readRecord, {
    revalidateOnFocus: false,
  });
  const preload = useSWRPreload();
  const mutate = useTenantMutate();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  useEffect(() => {
    void preload("child-prefetch", readRecord);
  }, [preload]);
  return (
    <section>
      <p data-testid="record">{data ?? "lädt"}</p>
      <label>
        Notiz
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          const write = deferred<void>();
          writes.push(write);
          void write.promise.then(() => {
            void mutate("child-record", "Gespeichert: Datensatz Mira");
            toast.success("Mira wurde gespeichert.");
          });
        }}
      >
        Speichern
      </button>
    </section>
  );
}

function OtherPage() {
  return <p>Andere Seite</p>;
}

/** Two routes like Next keeps them: the inactive one hidden, not gone. */
function Routes({ route }: { route: "record" | "other" }) {
  return (
    <>
      <Activity mode={route === "record" ? "visible" : "hidden"}>
        <RecordPage />
      </Activity>
      <Activity mode={route === "other" ? "visible" : "hidden"}>
        <OtherPage />
      </Activity>
    </>
  );
}

const MARK = "authjs.session-mark";

function setMark(value: string) {
  document.cookie = `${MARK}=${value}; path=/`;
}

/** The mark this page was rendered with; tests set the cookie to match. */
let renderedMark = "";

// The portal's login with its notice for a session the server ended.
let endedUrl: (() => string) | undefined;

function Portal({ route }: { route: "record" | "other" }) {
  return (
    <ToastProvider>
      <SWRScopeBoundary expectedTenantId="42" />
      <SessionTreeBoundary
        portal="tenant"
        sessionMark={{ name: MARK, rendered: renderedMark }}
        endedSessionUrl={endedUrl}
      >
        <Routes route={route} />
      </SessionTreeBoundary>
    </ToastProvider>
  );
}

const SYNTHETIC_RECORD = "Datensatz Mira";
const SYNTHETIC_DRAFT = "Entwurf über Mira";

/** Signs in, shows the record and a draft, then hides the route. */
async function hiddenRecordAndDraft() {
  signIn(session());
  const view = render(<Portal route="record" />);
  await act(async () => reads.at(-2)?.resolve(SYNTHETIC_RECORD));
  expect(screen.getByTestId("record")).toHaveTextContent(SYNTHETIC_RECORD);
  fireEvent.change(screen.getByRole("textbox", { name: "Notiz" }), {
    target: { value: SYNTHETIC_DRAFT },
  });
  view.rerender(<Portal route="other" />);
  // Hidden by React, still in the DOM: what a session change must remove.
  expect(screen.getByText("Andere Seite")).toBeVisible();
  expect(document.body).toHaveTextContent(SYNTHETIC_RECORD);
  expect(document.querySelector("textarea")).toHaveValue(SYNTHETIC_DRAFT);
  return view;
}

/** The test DOM's PageTransitionEvent does not carry `persisted`. */
function pageTransition(type: "pagehide" | "pageshow", persisted: boolean) {
  return Object.assign(new Event(type), { persisted });
}

function expectHiddenTreeGone() {
  expect(document.body).not.toHaveTextContent(SYNTHETIC_RECORD);
  expect(
    Array.from(document.querySelectorAll("textarea"), (area) => area.value),
  ).not.toContain(SYNTHETIC_DRAFT);
}

beforeEach(() => {
  document.cookie = `${MARK}=; path=/; max-age=0`;
  renderedMark = "";
  reads = [];
  writes = [];
  mockAnnounce.mockClear();
  mockReload.mockClear();
  sessionLookup.fails = false;
  sessionLookup.ended = false;
  sessionLookup.queue = [];
  endedUrl = undefined;
  sessionLookup.held = null;
  sessionLookup.claims = null;
  _resetSessionTreeForTests();
  _resetSessionMarksForTests();
  resetSWRScope({ revalidate: false });
  resumeSWRSession();
  sessionStore.set({ data: null, status: "unauthenticated" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionTreeBoundary", () => {
  it.each([
    ["logout", () => signOut()],
    ["another account", () => signIn(session({ id: "8" }))],
    ["another school", () => signIn(session({ tenantId: "43" }))],
    ["another Träger", () => signIn(session({ orgId: "5" }))],
    ["another portal scope", () => signIn(session({ scope: "school" }))],
    [
      "a staff preview",
      () => signIn(session({ previewTargetAccountId: "9" } as Partial<User>)),
    ],
    ["changed rights", () => signIn(session({ permissions: [] }))],
    [
      "an ended session",
      () => signIn({ ...session(), error: "RefreshTokenExpired" } as Session),
    ],
  ])(
    "removes record and draft from the hidden route on %s",
    async (_case, change) => {
      await hiddenRecordAndDraft();
      change();
      expectHiddenTreeGone();
    },
  );

  it("does not bring the old tree back on logout and login of the same account", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    const view = await hiddenRecordAndDraft();
    // The logout deleted the cookie.
    setMark("");
    signOut();
    // The provider's late answer names the old session again.
    signIn(session());
    view.rerender(<Portal route="record" />);
    // The document's tree ended for good: a new document confirms anew.
    expectHiddenTreeGone();
    expect(screen.queryByTestId("record")).not.toBeInTheDocument();
    expect(mockReload).toHaveBeenCalled();
  });

  it("keeps record and draft on a token rotation and shows them on return", async () => {
    const view = await hiddenRecordAndDraft();
    // A rotation hands a new session object with the same identity.
    signIn({ ...session(), expires: "2099-02-01" });
    view.rerender(<Portal route="record" />);
    expect(screen.getByTestId("record")).toHaveTextContent(SYNTHETIC_RECORD);
    expect(screen.getByRole("textbox", { name: "Notiz" })).toHaveValue(
      SYNTHETIC_DRAFT,
    );
  });

  it("drops late answers of reads, prefetches and writes of the old tree", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    const view = await hiddenRecordAndDraft();
    view.rerender(<Portal route="record" />);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const oldRequests = [...reads];
    const write = writes.at(-1)!;
    setMark("");
    signOut();
    signIn(session());
    view.rerender(<Portal route="record" />);
    // Every answer of the old session arrives after the change.
    await act(async () => {
      for (const request of oldRequests) request.resolve(SYNTHETIC_RECORD);
      write.resolve();
      await write.promise;
    });
    // Anker: the document leaves for a new one.
    expect(screen.getByText("Seite wird neu geladen...")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Gespeichert");
    // The old tree's toast shows nowhere.
    expect(document.body).not.toHaveTextContent("Mira wurde gespeichert.");
    expectHiddenTreeGone();
  });

  it("ends the tree when another tab of this origin bound a new owner", async () => {
    const view = await hiddenRecordAndDraft();
    act(() => {
      suspendSWRSession();
      resetSWRScope({ revalidate: false });
    });
    expectHiddenTreeGone();
    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeVisible();
    // The lookup confirms the new session: nothing comes back in place.
    act(() => resumeSWRSession());
    view.rerender(<Portal route="record" />);
    expect(screen.queryByTestId("record")).not.toBeInTheDocument();
  });

  it("discards the tree for a logout or switch that leaves the document", async () => {
    const discarded = vi.fn();
    const stop = onSessionTreeDiscard(discarded);
    await hiddenRecordAndDraft();
    act(() => discardSessionTree());
    expect(
      screen.getByRole("status", { name: "Seite wird neu geladen..." }),
    ).toBeInTheDocument();
    expectHiddenTreeGone();
    expect(discarded).toHaveBeenCalled();
    stop();
  });

  it("keeps no protected DOM for the back-forward cache and reloads a restored page", async () => {
    await hiddenRecordAndDraft();
    // A normal page show (first load) is no restore.
    window.dispatchEvent(pageTransition("pageshow", false));
    expect(mockReload).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(pageTransition("pagehide", true));
    });
    expectHiddenTreeGone();
    expect(screen.queryByText("Andere Seite")).not.toBeInTheDocument();
    expect(mockReload).not.toHaveBeenCalled();
    window.dispatchEvent(pageTransition("pageshow", true));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("reloads a page that shows again after its own pagehide without leaving", async () => {
    await hiddenRecordAndDraft();
    act(() => {
      window.dispatchEvent(pageTransition("pagehide", false));
    });
    window.dispatchEvent(pageTransition("pageshow", false));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("raises no toast of a discarded tree before it unmounts", () => {
    let raise: (message: string) => void = () => undefined;
    function Raiser() {
      const toast = useToast();
      raise = (message) => toast.success(message);
      return null;
    }
    render(
      <ToastProvider>
        <ToastSessionScope>
          <Raiser />
        </ToastSessionScope>
      </ToastProvider>,
    );
    act(() => raise("Vorher gespeichert."));
    // Anker: the scope's own toast shows while its tree lives.
    expect(screen.getByText("Vorher gespeichert.")).toBeVisible();
    // A late answer between the discard and the old tree's unmount.
    act(() => {
      announceSessionTreeDiscard();
      raise("Mira wurde gespeichert.");
    });
    expect(document.body).not.toHaveTextContent("Mira wurde gespeichert.");
  });

  it("clears the toasts of a discarded tree", async () => {
    const view = await hiddenRecordAndDraft();
    view.rerender(<Portal route="record" />);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => {
      writes.at(-1)!.resolve();
      await writes.at(-1)!.promise;
    });
    // Anker: the session's own toast shows.
    expect(await screen.findByText("Mira wurde gespeichert.")).toBeVisible();
    signOut();
    expect(
      screen.queryByText("Mira wurde gespeichert."),
    ).not.toBeInTheDocument();
  });

  it("keeps a server seed that resolves after the tree ended out of the DOM and the cache", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    signIn(session());
    let resolveSeed: (seed: ServerSeed) => void = () => undefined;
    const seed = new Promise<ServerSeed>((done) => {
      resolveSeed = done;
    });
    // The browser's own read never answers: only the seed could fill the key.
    const never = () => new Promise<string>(() => undefined);
    function SeededReader({ testId }: { testId: string }) {
      const { data } = useSWRAuth("seeded-record", never, {
        revalidateOnFocus: false,
      });
      return <p data-testid={testId}>{data ?? "lädt"}</p>;
    }
    render(
      <ToastProvider>
        <SWRScopeBoundary expectedTenantId="42" />
        <SessionTreeBoundary
          portal="tenant"
          sessionMark={{ name: MARK, rendered: renderedMark }}
        >
          <SWRServerSeed seed={seed} claims={["seeded-record"]}>
            <SeededReader testId="seeded" />
          </SWRServerSeed>
        </SessionTreeBoundary>
      </ToastProvider>,
    );
    // Anker: the seeded reader waits for the server's value.
    expect(screen.getByTestId("seeded")).toHaveTextContent("lädt");

    // Another tab's session ends the tree before the seed arrives.
    setMark("family-9");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeVisible();
    await act(async () => {
      resolveSeed({
        builtAt: Date.now(),
        generation: sessionGeneration(session())!,
        entries: [
          { key: "seeded-record", value: Promise.resolve("Seed Mira") },
        ],
      });
      await seed;
    });

    expect(screen.queryByTestId("seeded")).not.toBeInTheDocument();
    // Every entry of the raw cache, stale ones included.
    render(<RawCache />);
    // Anker: the probe read the cache.
    expect(screen.getByTestId("raw-cache")).toHaveAttribute("data-read");
    expect(document.body).not.toHaveTextContent("Seed Mira");
  });

  describe("when the session cookie changes under the tab", () => {
    const reloadOffer = () =>
      screen.getByRole("button", { name: "Seite neu laden" });

    it("drops the tree, its cache and toasts at once and offers to load again", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      const view = await hiddenRecordAndDraft();
      view.rerender(<Portal route="record" />);
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await act(async () => {
        writes.at(-1)!.resolve();
        await writes.at(-1)!.promise;
      });
      // Anker: the session's own toast shows.
      expect(await screen.findByText("Mira wurde gespeichert.")).toBeVisible();
      // Another tab signed in anew (another family of the shared cookie).
      setMark("family-2");
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expectHiddenTreeGone();
      expect(
        screen.queryByText("Mira wurde gespeichert."),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Deine Anmeldung hat sich in einem anderen Tab/),
      ).toBeVisible();
      // The page never switches back by itself; the person loads again.
      expect(mockAnnounce).not.toHaveBeenCalled();
      expect(mockReload).not.toHaveBeenCalled();
      fireEvent.click(reloadOffer());
      expect(mockReload).toHaveBeenCalledTimes(1);
    });

    it("drops a tree rendered before the cookie changed, on hydration", async () => {
      renderedMark = "family-1";
      setMark("family-2");
      signIn(session());
      render(<Portal route="record" />);
      expect(reloadOffer()).toBeVisible();
      expect(screen.queryByTestId("record")).not.toBeInTheDocument();
    });

    it("hides the server's HTML before its first paint when the cookie changed", () => {
      signIn(session());
      renderedMark = "family-1";
      const html = renderToString(<Portal route="record" />);
      const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
      // Anker: the server's HTML carries the check.
      expect(script).toContain(MARK);
      const run = new Function(script!);
      setMark("family-1");
      run();
      expect(document.documentElement).not.toHaveAttribute(
        "data-session-mark-stale",
      );
      setMark("family-2");
      run();
      expect(document.documentElement).toHaveAttribute(
        "data-session-mark-stale",
      );
      // The hydrated boundary decides and lifts it.
      render(<Portal route="record" />);
      expect(document.documentElement).not.toHaveAttribute(
        "data-session-mark-stale",
      );
      expect(reloadOffer()).toBeVisible();
    });

    it("hides nothing again on a later render of the layout", () => {
      setMark("family-1");
      const { rerender } = render(
        <StaleSessionMarkCheck
          sessionMark={{ name: MARK, rendered: "family-1" }}
        />,
      );
      expect(document.documentElement).not.toHaveAttribute(
        "data-session-mark-stale",
      );
      // A soft refresh (a language change) renders the layout with a mark
      // that is stale already: the boundary decides, the page stays shown.
      rerender(
        <StaleSessionMarkCheck
          sessionMark={{ name: MARK, rendered: "family-0" }}
        />,
      );
      expect(document.documentElement).not.toHaveAttribute(
        "data-session-mark-stale",
      );
    });

    it("drops the server's body when the page leaves before it hydrated", () => {
      delete document.documentElement.dataset.sessionTreeHydrated;
      const record = document.createElement("p");
      record.textContent = SYNTHETIC_DRAFT;
      document.body.append(record);
      new Function(staleMarkScript(MARK, ""))();
      window.dispatchEvent(new Event("pagehide"));
      // No protected DOM goes into the back-forward cache.
      expect(document.body).toBeEmptyDOMElement();
    });

    it("keeps the inline check closed against a cookie that carries markup", () => {
      const script = staleMarkScript(
        MARK,
        "</script><script>alert(1)</script>",
      );
      expect(script).not.toContain("</script>");
      expect(script).not.toContain("<script>");
    });

    it("checks again when a frozen document resumes", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      const view = await hiddenRecordAndDraft();
      view.rerender(<Portal route="record" />);
      // The provider reads the session again; the tree waits hidden, with
      // its draft, and shows again for the same session.
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
      expect(screen.getByRole("textbox", { name: "Notiz" })).toHaveValue(
        SYNTHETIC_DRAFT,
      );
      expect(screen.getByRole("textbox", { name: "Notiz" })).toBeVisible();
      // Another tab signed out meanwhile: the document loads the login.
      setMark("");
      act(() => {
        document.dispatchEvent(new Event("resume"));
      });
      expectHiddenTreeGone();
      expect(mockReload).toHaveBeenCalled();
    });

    it("drops the tree when its provider learns a change no answer of its own made", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      // Another tab changed the cookie; this tab's poll brings the new rights.
      setMark("family-2");
      signIn(session({ permissions: ["students:read", "groups:read"] }));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(reloadOffer()).toBeVisible();
      expectHiddenTreeGone();
    });

    it("ignores a change on a page without a session", () => {
      setMark("family-1");
      renderedMark = "family-1";
      render(<Portal route="record" />);
      setMark("family-2");
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      // Anker: the page without a session still renders.
      expect(screen.getByTestId("record")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Seite neu laden" }),
      ).not.toBeInTheDocument();
    });

    it("leaves for its own school switch whose answer names both marks", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      // The switch request carried family-1; its answer wrote family-2.
      setMark("family-2");
      await act(async () =>
        noteSessionAnswer(`${MARK}=family-2`, `${MARK}=family-1`),
      );
      // No lock: its own step; the document loads with the new session.
      expect(
        screen.queryByRole("button", { name: "Seite neu laden" }),
      ).not.toBeInTheDocument();
      expectHiddenTreeGone();
      expect(mockReload).toHaveBeenCalled();
    });

    it("keeps a resumed tree away when the server does not confirm its session", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      sessionLookup.fails = true;
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
      expectHiddenTreeGone();
      expect(reloadOffer()).toBeVisible();
    });

    it("drops the tree when this tab's own logout deleted the cookie", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      // The headers of the tab's own signout arrived: the browser deleted
      // the cookie and the answer names it. Its body is still on the way.
      beginSessionExit();
      setMark("");
      act(() => noteSessionAnswer(`${MARK}=`, null));
      expect(screen.getByText("Seite wird neu geladen...")).toBeInTheDocument();
      expectHiddenTreeGone();
    });

    it("drops the tree on a change between its first check and its listeners", () => {
      setMark("family-1");
      renderedMark = "family-1";
      signIn(session());
      // Another school's tab writes after the boundary's first check (a
      // layout effect) and before its listeners exist (a passive effect).
      function OtherTabWrites() {
        useLayoutEffect(() => setMark("family-2"), []);
        return null;
      }
      render(
        <>
          <Portal route="record" />
          <OtherTabWrites />
        </>,
      );
      expect(reloadOffer()).toBeVisible();
    });

    it("drops the tree on a change seen while the provider looks the session up", async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      setMark("family-2");
      // The provider looks the session up (a poll): the change goes at once.
      act(() => sessionStore.set({ data: session(), status: "loading" }));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(reloadOffer()).toBeVisible();
      expectHiddenTreeGone();
      // The lookup answering the same person brings nothing back.
      signIn(session());
      expect(reloadOffer()).toBeVisible();
      expectHiddenTreeGone();
    });

    it("drops the tree on a reported change a later write replaced", async () => {
      const cookieStore = new EventTarget();
      vi.stubGlobal("cookieStore", cookieStore);
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      // Another tab switched to family-2; a late rotation of the old family
      // wrote family-1 back before this tab compared.
      await act(async () => {
        cookieStore.dispatchEvent(
          Object.assign(new Event("change"), {
            changed: [{ name: MARK, value: "family-2" }],
            deleted: [],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(readSessionMark(MARK)).toBe("family-1");
      expect(reloadOffer()).toBeVisible();
      expectHiddenTreeGone();
    });

    it("drops the tree of a background tab when the browser reports the change", async () => {
      const cookieStore = new EventTarget();
      vi.stubGlobal("cookieStore", cookieStore);
      const hidden = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
      setMark("");
      await act(async () => {
        cookieStore.dispatchEvent(
          Object.assign(new Event("change"), {
            changed: [],
            deleted: [{ name: MARK }],
          }),
        );
        // Right away, before its guard could switch the shared cookie back.
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expectHiddenTreeGone();
      hidden.mockRestore();
    });
  });
});

describe("server checks of the session tree (#8082)", () => {
  it("ends the tree on a read that proves a change, also one a later read overtook", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();
    // The first read sees the school withdraw the portal; the second, from
    // a second resume, still the booking before.
    sessionLookup.queue = [{ notBooked: true }];
    let release: () => void = () => undefined;
    sessionLookup.held = new Promise<void>((done) => {
      release = done;
    });
    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });
    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });
    await act(async () => release());

    expectHiddenTreeGone();
    expect(mockReload).toHaveBeenCalled();
  });

  it("ends the tree whose HTML another session's cookie hid, also once a late write restored the mark", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    // The inline check saw another session before hydration.
    document.documentElement.setAttribute("data-session-mark-stale", "");
    document.documentElement.setAttribute("data-session-mark-seen", "family-9");
    signIn(session());

    render(<Portal route="record" />);

    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeVisible();
    expect(screen.queryByTestId("record")).not.toBeInTheDocument();
    expect(
      document.documentElement.hasAttribute("data-session-mark-seen"),
    ).toBe(false);
  });

  it("lets the reads go on once the server confirmed the session after another tab cleared the owner", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();

    await act(async () => {
      suspendSWRSession(true);
      resetSWRScope({ revalidate: false });
    });

    // Anker: the same tree shows again, with its draft.
    expect(screen.getByText("Andere Seite")).toBeVisible();
    expect(document.querySelector("textarea")).toHaveValue(SYNTHETIC_DRAFT);
    expect(isSWRSessionPending()).toBe(false);
  });

  it("offers to load again when a session from before marks cannot be checked after a resume", async () => {
    setMark("");
    renderedMark = "";
    await hiddenRecordAndDraft();
    sessionLookup.fails = true;

    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });

    expect(screen.getByText(/moto kann gerade nicht prüfen/)).toBeVisible();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("ends the tree on an unconfirmed read, also one a later read overtook", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();
    // The first read cannot be confirmed; the second, from a second check,
    // would confirm the same session.
    sessionLookup.queue = [{ sessionConfirmed: false }];
    let release: () => void = () => undefined;
    sessionLookup.held = new Promise<void>((done) => {
      release = done;
    });
    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });
    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });
    await act(async () => release());

    expectHiddenTreeGone();
    expect(screen.getByText(/moto kann gerade nicht prüfen/)).toBeVisible();
  });

  it("keeps a confirmed session once the other tab binds the same owner again", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();
    // Another tab's failed lookup cleared the owner; the server confirmed
    // this session.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "moto:personal-storage-owner",
          newValue: null,
        }),
      );
    });
    await act(async () => undefined);
    expect(isSWRSessionPending()).toBe(false);
    // That tab loads again and binds the same owner.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "moto:personal-storage-owner",
          newValue: personalStorageOwner(session().user),
        }),
      );
    });

    // Anker: the tree shows, with its draft.
    expect(screen.getByText("Andere Seite")).toBeVisible();
    expect(document.querySelector("textarea")).toHaveValue(SYNTHETIC_DRAFT);
    expect(isSWRSessionPending()).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Seite neu laden" }),
    ).not.toBeInTheDocument();
  });

  it("compares every value seen after a session from before marks took its first mark", async () => {
    const cookieStore = new EventTarget();
    vi.stubGlobal("cookieStore", cookieStore);
    setMark("");
    renderedMark = "";
    await hiddenRecordAndDraft();
    const change = (value: string) =>
      Object.assign(new Event("change"), {
        changed: [{ name: MARK, value }],
        deleted: [],
      });
    // This tab's first mark, then another session; a late write restored
    // the first before the boundary compared.
    act(() => {
      cookieStore.dispatchEvent(change("family-1"));
      cookieStore.dispatchEvent(change("family-9"));
    });
    setMark("family-1");
    await act(async () => noteSessionAnswer(`${MARK}=family-1`, null));

    expectHiddenTreeGone();
    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeVisible();
  });

  it("ends the tree when a refreshed layout names another session's mark", async () => {
    setMark("family-1");
    renderedMark = "family-1";
    const view = await hiddenRecordAndDraft();
    // A router refresh after another tab's switch: the server rendered the
    // layout with the other session, the cookie event never came.
    renderedMark = "family-9";
    view.rerender(<Portal route="other" />);
    await act(async () => undefined);

    expectHiddenTreeGone();
    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeVisible();
  });

  it("shows a tab that was only hidden at once, also after minutes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Five minutes hidden; the heartbeat goes on, throttled or not.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();

    expect(screen.getByText("Andere Seite")).toBeVisible();
    expect(
      screen.queryByText("Anmeldung wird geprüft..."),
    ).not.toBeInTheDocument();
  });

  it("leads a session the server ended to the portal's login with its notice", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    endedUrl = () => "/?error=SessionExpired";
    setMark("family-1");
    renderedMark = "family-1";
    await hiddenRecordAndDraft();

    signIn({ ...session(), error: "RefreshTokenExpired" } as Session);

    expectHiddenTreeGone();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/?error=SessionExpired"),
    );
    expect(mockReload).not.toHaveBeenCalled();
  });
});

/** Every value of the raw SWR cache, stale entries included. */
function RawCache() {
  const { cache } = useSWRConfig();
  const values = [...cache.keys()].map((key) => cache.get(key)?.data);
  return (
    <p data-testid="raw-cache" data-read="">
      {JSON.stringify(values)}
    </p>
  );
}

/**
 * The session tree's state table (#8082, docs/agents/contracts.md
 * "Protected tree per session"): every state of the tree × every event has
 * one outcome. Each row runs through the real boundary; the last test keeps
 * this table and the documented one the same.
 */
type TreeState =
  | "shown"
  | "unmarked"
  | "resuming"
  | "checking a signout"
  | "locked"
  | "leaving"
  | "signed out";
type TreeEvent =
  | "own step"
  | "own step of an exit"
  | "own step a late write undid"
  | "own deletion of an exit"
  | "own deletion of a lookup"
  | "own first mark"
  | "own first mark of another identity"
  | "other mark"
  | "other deletion"
  | "reported other value"
  | "rotation"
  | "new claims"
  | "module withdrawn"
  | "ended answer"
  | "failed provider lookup"
  | "owner change"
  | "owner change of a signout"
  | "resume"
  | "return after a suspension"
  | "boundary mounted again"
  | "same session read"
  | "ended read"
  | "new claims read"
  | "no session read"
  | "signed out read"
  | "pagehide"
  | "pageshow restored"
  | "exit";
type Outcome =
  | "stays"
  | "hides"
  | "leaves"
  | "reloads"
  | "restarts"
  | "locks"
  | "fails"
  | "adopts"
  | "ignores";

const TABLE: readonly (readonly [TreeState, TreeEvent, Outcome])[] = [
  ["shown", "own step", "reloads"],
  ["shown", "own step of an exit", "leaves"],
  ["shown", "own step a late write undid", "reloads"],
  ["shown", "own deletion of an exit", "leaves"],
  ["shown", "own deletion of a lookup", "reloads"],
  ["shown", "other mark", "locks"],
  ["shown", "other deletion", "reloads"],
  ["shown", "reported other value", "hides"],
  ["shown", "rotation", "stays"],
  ["shown", "new claims", "reloads"],
  ["shown", "module withdrawn", "reloads"],
  ["shown", "ended answer", "reloads"],
  ["shown", "failed provider lookup", "fails"],
  ["shown", "owner change", "locks"],
  ["shown", "owner change of a signout", "stays"],
  ["shown", "resume", "hides"],
  ["shown", "return after a suspension", "hides"],
  ["shown", "pagehide", "leaves"],
  ["shown", "pageshow restored", "restarts"],
  ["shown", "exit", "leaves"],
  ["unmarked", "own first mark", "stays"],
  ["unmarked", "own first mark of another identity", "reloads"],
  ["resuming", "same session read", "stays"],
  ["resuming", "new claims read", "reloads"],
  ["resuming", "no session read", "fails"],
  ["resuming", "ended read", "reloads"],
  ["resuming", "signed out read", "reloads"],
  ["resuming", "other mark", "locks"],
  ["resuming", "other deletion", "reloads"],
  ["resuming", "own step", "reloads"],
  ["resuming", "pagehide", "leaves"],
  ["checking a signout", "same session read", "stays"],
  ["checking a signout", "ended read", "reloads"],
  ["checking a signout", "no session read", "fails"],
  ["checking a signout", "signed out read", "reloads"],
  ["checking a signout", "new claims", "reloads"],
  ["locked", "own step", "locks"],
  ["locked", "new claims", "locks"],
  ["locked", "resume", "locks"],
  ["locked", "pageshow restored", "restarts"],
  ["locked", "boundary mounted again", "locks"],
  ["leaving", "own step", "leaves"],
  ["leaving", "other mark", "leaves"],
  ["leaving", "pageshow restored", "restarts"],
  ["signed out", "own step", "adopts"],
  ["signed out", "other mark", "ignores"],
];

describe("the session tree table (#8082)", () => {
  const reloadOffer = () =>
    screen.getByRole("button", { name: "Seite neu laden" });
  let release: () => void = () => undefined;
  const hold = () => {
    sessionLookup.held = new Promise<void>((done) => {
      release = () => {
        sessionLookup.held = null;
        done();
      };
    });
  };

  const enter: Record<TreeState, () => Promise<void>> = {
    shown: async () => {
      setMark("family-1");
      renderedMark = "family-1";
      await hiddenRecordAndDraft();
    },
    // A session from before marks: its tree has none.
    unmarked: async () => {
      setMark("");
      renderedMark = "";
      await hiddenRecordAndDraft();
    },
    resuming: async () => {
      await enter.shown();
      hold();
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
    },
    // Another tab cleared the owner; the server has not answered yet.
    "checking a signout": async () => {
      await enter.shown();
      hold();
      await happen["owner change of a signout"]();
    },
    locked: async () => {
      await enter.shown();
      setMark("family-9");
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    },
    leaving: async () => {
      await enter.shown();
      act(() => discardSessionTree());
    },
    "signed out": async () => {
      render(<Portal route="record" />);
    },
  };

  const ownStep = async () => {
    const from = readSessionMark(MARK);
    setMark("family-2");
    await act(async () =>
      noteSessionAnswer(`${MARK}=family-2`, `${MARK}=${from}`),
    );
  };
  const happen: Record<TreeEvent, () => Promise<void>> = {
    "own step": ownStep,
    // This tab's answer wrote another mark, but a late rotation of the old
    // session restored the tree's mark before the boundary compared.
    "own step a late write undid": async () => {
      const from = readSessionMark(MARK);
      await act(async () =>
        noteSessionAnswer(`${MARK}=family-2`, `${MARK}=${from}`),
      );
    },
    "own step of an exit": async () => {
      beginSessionExit();
      await ownStep();
    },
    "own deletion of an exit": async () => {
      beginSessionExit();
      setMark("");
      await act(async () => noteSessionAnswer(`${MARK}=`, null));
    },
    "own deletion of a lookup": async () => {
      setMark("");
      await act(async () => noteSessionAnswer(`${MARK}=`, null));
    },
    "own first mark": async () => {
      setMark("family-1");
      await act(async () => noteSessionAnswer(`${MARK}=family-1`, null));
    },
    // The server confirms another identity for the first mark (a staff
    // preview started from a session from before marks).
    "own first mark of another identity": async () => {
      sessionLookup.claims = { isPreview: true, previewTargetAccountId: "9" };
      setMark("family-1");
      await act(async () => noteSessionAnswer(`${MARK}=family-1`, null));
    },
    "other mark": async () => {
      setMark("family-9");
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    },
    // Another tab signed out: the cookie holds no session.
    "other deletion": async () => {
      setMark("");
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    },
    "reported other value": async () => {
      const cookieStore = new EventTarget();
      vi.stubGlobal("cookieStore", cookieStore);
      // Listeners bind on mount: render again with the store in place.
      cleanup();
      await enter.shown();
      act(() => {
        cookieStore.dispatchEvent(
          Object.assign(new Event("change"), {
            changed: [{ name: MARK, value: "family-9" }],
            deleted: [],
          }),
        );
      });
    },
    rotation: async () => {
      setMark("family-1");
      await act(async () => noteSessionAnswer(null, `${MARK}=family-1`));
    },
    "new claims": async () => {
      act(() => signIn(session({ roles: ["admin"] })));
    },
    // The school withdrew the portal's module; the poll reports it.
    "module withdrawn": async () => {
      act(() => signIn({ ...session(), notBooked: true } as Session));
    },
    "ended answer": async () => {
      act(() =>
        signIn({ ...session(), error: "RefreshTokenError" } as Session),
      );
    },
    // The provider's lookup failed: Auth.js answers no session while the
    // cookie still holds the tree's.
    "failed provider lookup": async () => {
      signOut();
    },
    "owner change": async () => {
      act(() => {
        suspendSWRSession();
        resetSWRScope({ revalidate: false });
      });
    },
    // Another tab signed out: it cleared the owner of personal storage once
    // its session was revoked, before its cookie went.
    "owner change of a signout": async () => {
      await act(async () => {
        suspendSWRSession(true);
        resetSWRScope({ revalidate: false });
      });
    },
    resume: async () => {
      hold();
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
    },
    // Back after the document's timers stood still for minutes: a browser
    // without `resume` suspended it.
    "return after a suspension": async () => {
      hold();
      const visibility = vi.spyOn(document, "visibilityState", "get");
      visibility.mockReturnValue("hidden");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      setTestClock(new Date(Date.now() + 121_000));
      visibility.mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      visibility.mockRestore();
    },
    // A soft navigation back from a page outside the tree (the help) mounts
    // a fresh boundary in the same document.
    "boundary mounted again": async () => {
      // The server renders the page with the mark the cookie holds now.
      renderedMark = readSessionMark(MARK);
      cleanup();
      await act(async () => {
        render(<Portal route="record" />);
      });
    },
    "ended read": async () => {
      sessionLookup.ended = true;
      await act(async () => release());
    },
    "same session read": async () => {
      await act(async () => release());
    },
    "new claims read": async () => {
      // The server answers other rights of the same mark.
      sessionLookup.claims = { roles: ["admin"] };
      await act(async () => release());
    },
    "no session read": async () => {
      sessionLookup.fails = true;
      await act(async () => release());
    },
    // No session, and the cookie holds none: the document shows the login.
    "signed out read": async () => {
      setMark("");
      sessionLookup.fails = true;
      await act(async () => release());
    },
    pagehide: async () => {
      act(() => {
        window.dispatchEvent(pageTransition("pagehide", false));
      });
    },
    "pageshow restored": async () => {
      act(() => {
        window.dispatchEvent(pageTransition("pageshow", true));
      });
    },
    exit: async () => {
      act(() => discardSessionTree());
    },
  };

  const noLock = () =>
    expect(
      screen.queryByRole("button", { name: "Seite neu laden" }),
    ).not.toBeInTheDocument();
  const outcome: Record<Outcome, () => void> = {
    // The tree and its draft as they were, shown, nothing locked.
    stays: () => {
      expect(
        Array.from(document.querySelectorAll("textarea"), (area) => area.value),
      ).toContain(SYNTHETIC_DRAFT);
      expect(screen.getByText("Andere Seite")).toBeVisible();
      noLock();
    },
    // Hidden with its draft, until the server or the decision answered.
    hides: () => {
      expect(
        Array.from(document.querySelectorAll("textarea"), (area) => area.value),
      ).toContain(SYNTHETIC_DRAFT);
      expect(screen.getByText("Anmeldung wird geprüft...")).toBeInTheDocument();
      expect(screen.queryByText("Andere Seite")).not.toBeVisible();
    },
    // The tree went; an exit navigates, and one that fails loads the
    // document (`sessionTreeState().leaving`).
    leaves: () => {
      expect(sessionTreeState().leaving).toBe(true);
      expectHiddenTreeGone();
      expect(screen.getByText("Seite wird neu geladen...")).toBeInTheDocument();
      noLock();
    },
    // The tree went; the document loads anew.
    reloads: () => {
      expectHiddenTreeGone();
      expect(mockReload).toHaveBeenCalled();
      noLock();
    },
    // A restored document asks the server again.
    restarts: () => {
      expect(mockReload).toHaveBeenCalled();
    },
    // The tree went; the person loads again.
    locks: () => {
      expectHiddenTreeGone();
      expect(reloadOffer()).toBeVisible();
    },
    // The tree went; the server could not confirm the session, and the
    // screen says so (no claim of another tab's change).
    fails: () => {
      expectHiddenTreeGone();
      expect(reloadOffer()).toBeVisible();
      expect(
        screen.getByText(/moto kann gerade nicht prüfen/),
      ).toBeInTheDocument();
    },
    // A page without a session takes its own sign-in's mark.
    adopts: () => {
      expect(shownSessionMark()).toBe("family-2");
      noLock();
    },
    // A page without a session takes no other tab's mark as its own.
    ignores: () => {
      expect(shownSessionMark()).toBe("");
      noLock();
    },
  };

  it.each(TABLE)("%s, %s: %s", async (state, event, result) => {
    await enter[state]();
    await happen[event]();
    outcome[result]();
    release();
  });

  it("is the table docs/agents/contracts.md documents", () => {
    const docs = readFileSync(
      path.join(process.cwd(), "../docs/agents/contracts.md"),
      "utf8",
    );
    const section = docs.slice(
      docs.indexOf("| Tree state | Event | Outcome |"),
    );
    const lines = section.split("\n").map((line) => line.trim());
    const end = lines.findIndex(
      (line, index) => index > 1 && !line.startsWith("|"),
    );
    const rows = lines.slice(2, end).map((line) =>
      line
        .split("|")
        .slice(1, 4)
        .map((cell) => cell.trim().replace(/`/g, "")),
    );
    expect(rows).toEqual(TABLE.map((row) => [...row]));
  });
});
