import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { suppressConsole } from "~/test/helpers/console";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./catalog-proxy.server";
import { noData, success } from "./runtime";

// The public path of the catalog proxy (#2352) on the real backend client:
// fetch stands for the backend. The portal's handlers stand for a session
// that exists on the device; a public route must never touch them.
vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://backend.test",
}));

const fetchMock = vi.fn<typeof fetch>();
let sessionReads = 0;

const session = () => async (): Promise<Response> => {
  sessionReads++;
  return Response.json({ data: "session route" });
};
const portal = {
  get: session,
  delWithBody: session,
  post: session,
  put: session,
  patch: session,
  api: vi.fn(() => {
    throw new Error("a public route reached the session client");
  }),
} as unknown as Parameters<typeof makeCatalogProxy>[0];

const row = success(z.object({ name: z.string() }));
const sessionRoutes: CatalogRoute[] = [
  { method: "GET", pattern: "/api/rows/{id}/history", response: row },
  { method: "GET", pattern: "/api/rows/{id}", response: row },
];
const publicRoutes: CatalogRoute[] = [
  {
    method: "GET",
    pattern: "/api/rows/public/{token}",
    query: ["late_invite"],
    response: row,
  },
  {
    method: "POST",
    pattern: "/api/rows/public/{token}/submit",
    maxBodyBytes: 32,
    response: row,
  },
  {
    method: "POST",
    pattern: "/api/rows/public/{token}/withdraw",
    maxBodyBytes: 32,
    response: noData,
  },
  { method: "GET", pattern: "/links/{link}", response: row },
  // Beside the mount, but not on the public list of heads.
  { method: "GET", pattern: "/hidden/{link}", response: row },
];

function call(
  method: CatalogMethod,
  path: string[],
  init: { body?: string; headers?: Record<string, string> } = {},
) {
  const request = new NextRequest(
    `http://school-a.localhost/api/${path.join("/")}?late_invite=t&debug=1`,
    {
      method,
      body: init.body,
      headers: {
        "x-forwarded-for": "203.0.113.10, 172.20.0.4",
        "Idempotency-Key": "key-1",
        ...init.headers,
      },
    },
  );
  return makeCatalogProxy(portal, "/api", sessionRoutes, method, [], {
    routes: publicRoutes,
    outside: ["/links"],
  })(request, { params: Promise.resolve({ path }) });
}

const answer = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

function sentHeaders(): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("makeCatalogProxy, public routes", () => {
  suppressConsole("error", "warn", "log");

  beforeEach(() => {
    sessionReads = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards without the session and answers privately", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ status: "success", data: { name: "Ada" } }),
    );
    const response = await call("GET", ["rows", "public", "tok"]);

    expect(await response.json()).toEqual({
      success: true,
      message: "Success",
      data: { name: "Ada" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sessionReads).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://backend.test/api/rows/public/tok?late_invite=t",
    );
    expect(sentHeaders()).not.toHaveProperty("Authorization");
    // The backend limits a public link per client address.
    expect(sentHeaders()["X-Forwarded-For"]).toBe("172.20.0.4");
  });

  it("prefers the public literal over a session parameter, as chi does", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ status: "success", data: { name: "Ada" } }),
    );
    // Both /api/rows/{id}/history and /api/rows/public/{token} match.
    await call("GET", ["rows", "public", "history"]);
    expect(sessionReads).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://backend.test/api/rows/public/history?late_invite=t",
    );
  });

  it("leaves a session route to the portal's handlers", async () => {
    await call("GET", ["rows", "7"]);
    expect(sessionReads).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a backend 401 on without renewing a session", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        { status: 401, code: "enrollment.status_link_invalid", detail: "x" },
        {
          status: 401,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );
    const response = await call("GET", ["rows", "public", "tok"]);
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sessionReads).toBe(0);
  });

  it("keeps the backend's code and Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        {
          type: "about:blank",
          title: "Too Many Requests",
          status: 429,
          code: "identity.invitation_rate_limited",
          detail: "slow down",
        },
        {
          status: 429,
          headers: {
            "Content-Type": "application/problem+json",
            "Retry-After": "120",
          },
        },
      ),
    );
    const response = await call("POST", ["rows", "public", "tok", "submit"], {
      body: JSON.stringify({ a: 1 }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await response.json()).toMatchObject({
      code: "identity.invitation_rate_limited",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sends a write with its body and idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ status: "success", data: { name: "Ada" } }, { status: 201 }),
    );
    await call("POST", ["rows", "public", "tok", "submit"], {
      body: JSON.stringify({ a: 1 }),
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect(sentHeaders()["Idempotency-Key"]).toBe("key-1");
    expect(sentHeaders()).not.toHaveProperty("Authorization");
  });

  it("answers an oversized body 413 without a backend call", async () => {
    const response = await call("POST", ["rows", "public", "tok", "submit"], {
      body: JSON.stringify({ text: "x".repeat(64) }),
    });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a backend 204 as a result without data", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await call("POST", ["rows", "public", "tok", "withdraw"]);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown }).data).toBeNull();
  });

  it("refuses an answer outside the contract with 502", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ status: "success", data: { name: 7 } }),
    );
    const response = await call("GET", ["rows", "public", "tok"]);
    expect(response.status).toBe(502);
  });

  it("reaches a public route on its listed head beside the mount", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ status: "success", data: { name: "Ada" } }),
    );
    await call("GET", ["links", "abc"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://backend.test/links/abc");
  });

  it.each([
    ["an unregistered public path", ["rows", "public", "tok", "secret"]],
    ["a public route beside the mount on no listed head", ["hidden", "abc"]],
  ])("answers 404 for %s without a backend call", async (_name, path) => {
    const response = await call("GET", path);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionReads).toBe(0);
  });
});
