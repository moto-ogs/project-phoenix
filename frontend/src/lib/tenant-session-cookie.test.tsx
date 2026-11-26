import { act, render } from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSessionTreeForTests, sessionTreeState } from "./session-tree";
import {
  SessionReplaced,
  signOutPortal,
  signOutTenant,
} from "./tenant-session-cookie";

it("does not refresh the real current provider while destination navigation is stalled", async () => {
  const channels = new Set<TestChannel>();
  class TestChannel extends EventTarget {
    constructor(readonly name: string) {
      super();
      channels.add(this);
    }
    postMessage(data: unknown) {
      for (const channel of channels) {
        if (channel !== this && channel.name === this.name) {
          queueMicrotask(() =>
            channel.dispatchEvent(new MessageEvent("message", { data })),
          );
        }
      }
    }
    close() {
      channels.delete(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", TestChannel);
  const originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "http://school-a.localhost/home" },
  });
  const session = {
    user: { id: "7" },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith("/csrf")
        ? { csrfToken: crypto.randomUUID() }
        : url.endsWith("/session")
          ? session
          : { url: "http://school-b.localhost/" },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    render(
      <SessionProvider session={session} refetchOnWindowFocus={false}>
        <div>Session active</div>
      </SessionProvider>,
    );
    // Prove that another channel really reaches the installed provider.
    const otherTab = new BroadcastChannel("next-auth");
    await act(async () => {
      otherTab.postMessage({ event: "session", data: { trigger: "signout" } });
    });
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/session"))).toBe(
      true,
    );
    fetch.mockClear();
    await act(async () => {
      await signOutTenant(
        { callbackUrl: "http://school-b.localhost/", revoked: true, mark: "" },
        new AbortController().signal,
      );
    });
    expect(window.location.href).toBe("http://school-b.localhost/");
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/session")),
    ).toHaveLength(0);
    otherTab.close();
  } finally {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signOutPortal (#8082)", () => {
  const answers = (signout: unknown) =>
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith("/csrf") ? { csrfToken: crypto.randomUUID() } : signout,
      ),
    );

  it("asks for no session after the cookie went", async () => {
    const fetch = answers({ url: "http://traeger.localhost/login" });
    vi.stubGlobal("fetch", fetch);

    await signOutPortal("/api/traeger/auth", "/login", {
      portal: "traeger",
      mark: "",
    });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/traeger/auth/csrf",
      "/api/traeger/auth/signout",
    ]);
  });

  it("fails when Auth.js refused the signout with its error page", async () => {
    vi.stubGlobal(
      "fetch",
      answers({
        url: "http://traeger.localhost/api/traeger/auth/error?error=MissingCSRF",
      }),
    );

    await expect(
      signOutPortal("/api/traeger/auth", "/login", {
        portal: "traeger",
        mark: "",
      }),
    ).rejects.toThrow("Logout refused");
  });
});

describe("signOutTenant after a revocation (#8082)", () => {
  const refused = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith("/csrf")
        ? { csrfToken: crypto.randomUUID() }
        : { url: "http://school-a.localhost/api/auth/error?error=MissingCSRF" },
    ),
  );
  let originalLocation: Location;
  beforeEach(() => {
    _resetSessionTreeForTests();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://school-a.localhost/home" },
    });
    vi.stubGlobal("fetch", refused);
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("keeps the page when Auth.js refused and the family was not revoked", async () => {
    await expect(
      signOutTenant(
        { callbackUrl: "/", revoked: false, mark: "" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Logout refused");
    expect(window.location.href).toBe("http://school-a.localhost/home");
    expect(sessionTreeState().leaving).toBe(false);
  });

  it("still leaves when Auth.js refused but the family is revoked", async () => {
    await signOutTenant(
      { callbackUrl: "/", revoked: true, mark: "" },
      new AbortController().signal,
    );
    expect(window.location.href).toBe("/");
    expect(sessionTreeState().leaving).toBe(true);
  });
});

describe("signOutTenant on a cookie another school's tab replaced (#8082)", () => {
  let originalLocation: Location;
  beforeEach(() => {
    _resetSessionTreeForTests();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://school-a.localhost/home", reload: vi.fn() },
    });
  });
  afterEach(() => {
    document.cookie = "authjs.session-mark=; path=/; max-age=0";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("deletes nothing and loads the new session", async () => {
    // The exit of session cookies kept the session another school's tab
    // signed in with and says so.
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/csrf")
        ? Response.json({ csrfToken: crypto.randomUUID() })
        : Response.json(
            { url: "http://school-a.localhost/" },
            { headers: { "X-Moto-Session-Replaced": "1" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);

    await signOutTenant(
      { callbackUrl: "/", revoked: true, mark: "family-a" },
      new AbortController().signal,
    );

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe("http://school-a.localhost/home");
    expect(sessionTreeState().leaving).toBe(true);
  });
});

describe("signOutPortal when the exit of session cookies keeps another session (#8082)", () => {
  it("fails with SessionReplaced and says which session it ends", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/csrf")
        ? Response.json({ csrfToken: crypto.randomUUID() })
        : Response.json(
            { url: "http://traeger.localhost/login" },
            { headers: { "X-Moto-Session-Replaced": "1" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      signOutPortal("/api/traeger/auth", "/login", {
        portal: "traeger",
        mark: "family-a",
      }),
    ).rejects.toBeInstanceOf(SessionReplaced);
    const headers = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(headers.get("X-Moto-End-Session")).toBe("traeger family-a");
  });
});
