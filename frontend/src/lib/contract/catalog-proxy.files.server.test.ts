import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { makePortalHandlers } from "~/lib/portal-handlers.server";
import { testPortalBinding } from "~/test/portal-binding";
import {
  makeCatalogProxy,
  privateCacheControl,
  type CatalogMethod,
  type CatalogRoute,
} from "./catalog-proxy.server";
import { fileAnswer, multipart, noData, success } from "./runtime";

// The file and upload kinds of the catalog proxy (ADR 0270, addendum of
// 2026-11-19), on the real portal handlers: session, renewal, backend client
// and file response are the production ones, only fetch and the session
// reader are doubles.

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://backend",
}));

const mockFetch = vi.fn();
const mockAuth = vi.fn();
const portal = makePortalHandlers(testPortalBinding(mockAuth));

const LIMIT = 1024;
const routes: CatalogRoute[] = [
  {
    method: "GET",
    pattern: "/traeger/rows/export",
    query: ["format", "from"],
    response: fileAnswer,
  },
  {
    method: "GET",
    pattern: "/traeger/rows/{id}/logo",
    query: ["v"],
    privateCache: true,
    response: fileAnswer,
  },
  {
    method: "POST",
    pattern: "/traeger/rows/{id}/letters",
    maxBodyBytes: 64,
    response: fileAnswer,
  },
  {
    method: "POST",
    pattern: "/traeger/rows/{id}/proofs",
    maxBodyBytes: LIMIT,
    tooLargeCode: "enrollment.upload_invalid",
    request: multipart,
    response: success(z.object({ id: z.string() })),
  },
  {
    method: "POST",
    pattern: "/traeger/rows/{id}/proofs/complete",
    maxBodyBytes: LIMIT,
    tooLargeCode: "enrollment.upload_invalid",
    request: multipart,
    response: noData,
  },
];

function call(
  method: CatalogMethod,
  path: string[],
  init: ConstructorParameters<typeof NextRequest>[1] = {},
  search = "",
) {
  const request = new NextRequest(
    `http://localhost:3000/api/traeger/${path.join("/")}${search}`,
    { method, ...init },
  );
  return makeCatalogProxy(
    portal,
    "/traeger",
    routes,
    method,
  )(request, {
    params: Promise.resolve({ path }),
  });
}

/** A request body the test feeds piece by piece. */
function feed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return { stream, controller };
}

const uploadHeaders = (length: number) => ({
  "content-type": "multipart/form-data; boundary=x",
  "content-length": String(length),
});

function upload(
  body: BodyInit,
  headers: Record<string, string> = uploadHeaders(4),
) {
  return call("POST", ["rows", "7", "proofs"], {
    body,
    headers,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

const problem = (status: number, code: string) =>
  new Response(
    JSON.stringify({
      type: "about:blank",
      title: "refused",
      status,
      detail: "refused",
      code,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );

/** What fetch received as the request body, read to the end. */
async function sentBytes() {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  const body = init.body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

beforeEach(() => {
  mockFetch.mockReset();
  mockAuth.mockReset().mockResolvedValue({ user: { token: "org-token" } });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("catalog file route", () => {
  it("streams the answer before the backend has sent all of it", async () => {
    const upstream = feed();
    mockFetch.mockResolvedValue(
      new Response(upstream.stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="liste.csv"',
          "Content-Length": "4",
          "Cache-Control": "public, max-age=3600",
        },
      }),
    );

    const response = await call("GET", ["rows", "export"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="liste.csv"',
    );
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const reader = response.body!.getReader();
    upstream.controller.enqueue(new Uint8Array([1, 2]));
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([1, 2]),
    });
    upstream.controller.enqueue(new Uint8Array([3, 4]));
    upstream.controller.close();
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([3, 4]),
    });
    expect((await reader.read()).done).toBe(true);
  });

  it("forwards only the registered query parameters, with the bearer", async () => {
    mockFetch.mockResolvedValue(new Response("a;b\n"));

    await call(
      "GET",
      ["rows", "export"],
      {},
      "?format=pdf&from=2026-09-01&evil=1",
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend/traeger/rows/export?format=pdf&from=2026-09-01",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer org-token",
        }),
      }),
    );
  });

  it("passes a backend refusal on as its problem, private and uncached", async () => {
    mockFetch.mockResolvedValue(problem(403, "general.permission"));

    const response = await call("GET", ["rows", "export"]);

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      status: 403,
      code: "general.permission",
    });
  });

  it("repeats a GET once with the renewed session after a backend 401", async () => {
    mockAuth
      .mockResolvedValueOnce({ user: { token: "old" } })
      .mockResolvedValueOnce({ user: { token: "old" } })
      .mockResolvedValue({ user: { token: "new" } });
    mockFetch
      .mockResolvedValueOnce(problem(401, "general.permission"))
      .mockResolvedValueOnce(new Response("a;b\n"));

    const response = await call("GET", ["rows", "export"]);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends the JSON body of a file POST within the route's limit", async () => {
    mockFetch.mockResolvedValue(new Response("%PDF"));

    const ok = await call("POST", ["rows", "7", "letters"], {
      body: JSON.stringify({ text: "Hallo" }),
    });
    const tooLarge = await call("POST", ["rows", "7", "letters"], {
      body: JSON.stringify({ text: "x".repeat(100) }),
    });

    expect(ok.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(await sentBytes())).toBe(
      '{"text":"Hallo"}',
    );
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

/**
 * A file the contract marks `privateCache` keeps the backend's private
 * Cache-Control (an image whose address names its version, #2352); every
 * other file, and every refusal, stays private and uncached.
 */
describe("catalog file cache", () => {
  const image = (cacheControl?: string) =>
    new Response(new Uint8Array([0x89, 0x50]), {
      headers: {
        "Content-Type": "image/png",
        ...(cacheControl && { "Cache-Control": cacheControl }),
      },
    });

  it("passes a private cache policy of a marked file on", async () => {
    mockFetch.mockResolvedValue(image("private, max-age=31536000, immutable"));

    const response = await call("GET", ["rows", "7", "logo"], {}, "?v=1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://backend/traeger/rows/7/logo?v=1",
    );
  });

  it.each([
    ["a public policy", "public, max-age=86400"],
    ["a policy that is not private", "max-age=86400"],
    ["no policy", undefined],
  ])("never lets a marked file out with %s", async (_name, policy) => {
    mockFetch.mockResolvedValue(image(policy));

    const response = await call("GET", ["rows", "7", "logo"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps a refusal of a marked file uncached", async () => {
    mockFetch.mockResolvedValue(problem(404, "general.not_found"));

    const response = await call("GET", ["rows", "7", "logo"]);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps a missing session of a marked file uncached", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await call("GET", ["rows", "7", "logo"]);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("drops the backend's cache policy of an unmarked file", async () => {
    mockFetch.mockResolvedValue(
      new Response("a;b\n", {
        headers: { "Cache-Control": "private, max-age=86400" },
      }),
    );

    const response = await call("GET", ["rows", "export"]);

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reads private and public as directives, not as text", () => {
    expect(privateCacheControl("Private, Max-Age=60")).toBe(
      "Private, Max-Age=60",
    );
    expect(privateCacheControl("private, public")).toBe("private, no-store");
    expect(privateCacheControl("max-age=60, x-private")).toBe(
      "private, no-store",
    );
  });
});

describe("catalog multipart upload", () => {
  it("normalizes a successful 204 to a 200 no-data envelope", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await call("POST", ["rows", "7", "proofs", "complete"], {
      body: "abcd",
      headers: uploadHeaders(4),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Success",
      data: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("streams the body to the backend before the browser has sent all of it", async () => {
    const browser = feed();
    let received = new Uint8Array();
    mockFetch.mockImplementation(async (_url, init: RequestInit) => {
      // The backend call starts while the request is still open.
      browser.controller.enqueue(new Uint8Array([3, 4]));
      browser.controller.close();
      received = new Uint8Array(await new Response(init.body).arrayBuffer());
      return Response.json(
        { status: "success", data: { id: "9" } },
        { status: 201 },
      );
    });
    browser.controller.enqueue(new Uint8Array([1, 2]));

    const response = await upload(browser.stream);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      message: "Success",
      data: { id: "9" },
    });
    expect(received).toEqual(new Uint8Array([1, 2, 3, 4]));
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://backend/traeger/rows/7/proofs");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer org-token",
      "Content-Type": "multipart/form-data; boundary=x",
    });
  });

  it("answers a body its Content-Length puts over the limit 413 with the route's code, without a backend call", async () => {
    const response = await upload("x", uploadHeaders(LIMIT + 1));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "enrollment.upload_invalid",
      details: { max_bytes: LIMIT, max_mb: 0 },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("answers 413 when the body grows past the limit it did not declare", async () => {
    mockFetch.mockImplementation(async (_url, init: RequestInit) => {
      await new Response(init.body).arrayBuffer();
      return Response.json({ status: "success", data: { id: "9" } });
    });

    const response = await upload(
      new Uint8Array(LIMIT + 10),
      uploadHeaders(10),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "enrollment.upload_invalid",
    });
  });

  it("refuses an upload that is no multipart body or names no length", async () => {
    const json = await upload("{}", {
      "content-type": "application/json",
      "content-length": "2",
    });
    const unsized = await upload("x", {
      "content-type": "multipart/form-data; boundary=x",
    });

    expect(json.status).toBe(400);
    expect(unsized.status).toBe(411);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends the body once: a backend 401 is the answer, not a retry", async () => {
    mockFetch.mockResolvedValue(problem(401, "general.permission"));

    const response = await upload("abcd");

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // An import whose later batch failed answers 500 with the saved part in
  // details.result; the page shows it (#2352, readImportBatchFailure).
  it("keeps a coded 500 with its details, such as a failed import batch", async () => {
    const result = { total_rows: 3, created_count: 2, errors: [] };
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "batch 2 failed",
          code: "import.import_batch_failed",
          details: { result },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );
    const response = await upload("abcd");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: "import.import_batch_failed",
      details: { result },
    });
  });

  it("passes the backend's refusal of the file on as its problem", async () => {
    mockFetch.mockResolvedValue(problem(400, "enrollment.upload_invalid"));

    const response = await upload("abcd");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "enrollment.upload_invalid",
    });
  });
});

describe("catalog file and upload access", () => {
  it("answers 404 for a path the portal does not register, before session and backend", async () => {
    const response = await call("GET", ["rows", "other-export"]);

    expect(response.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("answers 404 for a route of another portal", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/parent/rows/export",
    );
    const response = await makeCatalogProxy(
      portal,
      "/parent",
      routes,
      "GET",
    )(request, { params: Promise.resolve({ path: ["rows", "export"] }) });

    expect(response.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("answers 401 without a session, before the backend", async () => {
    mockAuth.mockResolvedValue(null);

    const file = await call("GET", ["rows", "export"]);
    const sent = await upload("abcd");

    expect(file.status).toBe(401);
    expect(file.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sent.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never serves a file route on the session-free path", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/traeger/rows/export",
    );
    const response = await makeCatalogProxy(portal, "/traeger", [], "GET", [], {
      routes,
    })(request, { params: Promise.resolve({ path: ["rows", "export"] }) });

    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
