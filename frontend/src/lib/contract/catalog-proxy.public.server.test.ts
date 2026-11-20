import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { suppressConsole } from "~/test/helpers/console";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./catalog-proxy.server";
import { fileAnswer, multipart, noData, success } from "./runtime";

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
  // Public files: served only with the contract's marker (#2352).
  {
    method: "GET",
    pattern: "/api/rows/public/{token}/proof",
    response: fileAnswer,
    publicFile: "the status link is the credential",
  },
  {
    method: "POST",
    pattern: "/links/{link}/download",
    response: fileAnswer,
    publicFile: "the one-time link is the credential",
  },
  // A public asset any cache may keep, and a feed its client keeps (#2352).
  {
    method: "GET",
    pattern: "/api/rows/public/assets/{filename}",
    response: fileAnswer,
    publicFile: "a school's public asset",
    fileCache: "public, max-age=86400",
  },
  {
    method: "GET",
    pattern: "/api/rows/public/{token}/feed",
    response: fileAnswer,
    publicFile: "the feed token is the credential",
    fileCache: "private, max-age=3600",
  },
  // A public file without the marker, and a public upload, stay refused.
  {
    method: "GET",
    pattern: "/api/rows/public/{token}/file",
    response: fileAnswer,
  },
  {
    method: "POST",
    pattern: "/api/rows/public/{token}/upload",
    request: multipart,
    maxBodyBytes: 1024,
    response: row,
    publicFile: "an upload is never a public file",
  },
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

const pdf = new Uint8Array([37, 80, 68, 70, 45, 49]);

const fileAnswerOf = (init: ResponseInit = {}) =>
  new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="vertrag.pdf"',
      "Content-Length": String(pdf.length),
      // A mistaken upstream policy must not make a link's file cacheable.
      "Cache-Control": "public, max-age=3600",
      ETag: '"v1"',
    },
    ...init,
  });

const problem = (
  status: number,
  code: string,
  headers: Record<string, string> = {},
) =>
  answer(
    { type: "about:blank", title: "x", status, code, detail: "x" },
    {
      status,
      headers: { "Content-Type": "application/problem+json", ...headers },
    },
  );

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

  describe("public files", () => {
    const credentials = {
      Cookie: "authjs.session-token=staff-session; __Secure-x=1",
      Authorization: "Bearer device-staff-token",
    };

    it("streams a marked file with its headers, privately and uncached", async () => {
      fetchMock.mockResolvedValueOnce(fileAnswerOf());
      const response = await call("GET", ["rows", "public", "tok", "proof"], {
        headers: credentials,
      });

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        'inline; filename="vertrag.pdf"',
      );
      expect(response.headers.get("Content-Length")).toBe(String(pdf.length));
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("ETag")).toBeNull();
      // Only registered query parameters travel; this route has none.
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "http://backend.test/api/rows/public/tok/proof",
      );
      expect(sessionReads).toBe(0);
    });

    it("sends neither the device's session cookie nor its Authorization", async () => {
      fetchMock.mockResolvedValueOnce(fileAnswerOf());
      await call("GET", ["rows", "public", "tok", "proof"], {
        headers: credentials,
      });
      const names = Object.keys(sentHeaders()).map((name) =>
        name.toLowerCase(),
      );
      expect(names).not.toContain("authorization");
      expect(names).not.toContain("cookie");
      expect(JSON.stringify(sentHeaders())).not.toMatch(
        /staff-session|device-staff-token/,
      );
      // The backend's limiter of the link keys on the client address.
      expect(sentHeaders()["X-Forwarded-For"]).toBe("172.20.0.4");
      expect(portal.api).not.toHaveBeenCalled();
    });

    it("opens a POST link without a body or idempotency key", async () => {
      fetchMock.mockResolvedValueOnce(fileAnswerOf());
      const response = await call("POST", ["links", "7.secret", "download"], {
        body: JSON.stringify({ forged: true }),
        headers: credentials,
      });
      expect(response.status).toBe(200);
      const init = fetchMock.mock.calls[0]?.[1];
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "http://backend.test/links/7.secret/download",
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      expect(sentHeaders()).not.toHaveProperty("Idempotency-Key");
      expect(sentHeaders()).not.toHaveProperty("Content-Type");
      expect(sentHeaders()).not.toHaveProperty("Authorization");
    });

    it.each([
      ["an unknown or altered token", 404, "enrollment.status_link_invalid"],
      ["a used or expired link", 410, "care_contract.signing_link_invalid"],
    ])(
      "passes the backend's answer to %s on, privately",
      async (_name, status, code) => {
        fetchMock.mockResolvedValueOnce(problem(status, code));
        const response = await call("GET", ["rows", "public", "tok", "proof"]);
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ code });
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(sessionReads).toBe(0);
      },
    );

    it("keeps the route's public cache on a public asset only when served", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(pdf, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        }),
      );
      const served = await call("GET", ["rows", "public", "assets", "a.png"], {
        headers: credentials,
      });
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe("image/png");
      expect(served.headers.get("Cache-Control")).toBe("public, max-age=86400");
      expect(sentHeaders()).not.toHaveProperty("Authorization");
      expect(sentHeaders()).not.toHaveProperty("Cookie");

      fetchMock.mockResolvedValueOnce(problem(404, "general.not_found"));
      const missing = await call("GET", ["rows", "public", "assets", "b.png"]);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("keeps a feed's private cache on the feed, never on its refusal", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("BEGIN:VCALENDAR", {
          headers: { "Content-Type": "text/calendar; charset=utf-8" },
        }),
      );
      const feed = await call("GET", ["rows", "public", "tok", "feed"]);
      expect(feed.status).toBe(200);
      expect(feed.headers.get("Content-Type")).toBe(
        "text/calendar; charset=utf-8",
      );
      expect(feed.headers.get("Cache-Control")).toBe("private, max-age=3600");
      expect(await feed.text()).toBe("BEGIN:VCALENDAR");

      fetchMock.mockResolvedValueOnce(problem(404, "general.not_found"));
      const unknown = await call("GET", ["rows", "public", "tok", "feed"]);
      expect(unknown.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("keeps the backend limiter's 429 and Retry-After", async () => {
      fetchMock.mockResolvedValueOnce(
        problem(429, "general.rate_limited", { "Retry-After": "60" }),
      );
      const response = await call("POST", ["links", "7.secret", "download"]);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(await response.json()).toMatchObject({
        code: "general.rate_limited",
      });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("answers an unreachable backend privately as well", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      const response = await call("GET", ["rows", "public", "tok", "proof"]);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("returns the file before the backend has sent all of it", async () => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(body, { headers: { "Content-Type": "application/pdf" } }),
      );
      const response = await call("GET", ["rows", "public", "tok", "proof"]);
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      controller.enqueue(new Uint8Array([1, 2]));
      expect((await reader.read()).value).toEqual(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
      expect((await reader.read()).value).toEqual(new Uint8Array([3]));
      expect((await reader.read()).done).toBe(true);
    });

    it.each([
      ["a missing token", "GET", ["rows", "public", "", "proof"]],
      ["a dot token", "GET", ["rows", "public", "..", "proof"]],
      [
        "a public file without the marker",
        "GET",
        ["rows", "public", "tok", "file"],
      ],
      ["a public upload", "POST", ["rows", "public", "tok", "upload"]],
    ] as const)(
      "answers 404 for %s without a backend call",
      async (_name, method, path) => {
        const response = await call(method, [...path], {
          headers: credentials,
        });
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sessionReads).toBe(0);
      },
    );
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
