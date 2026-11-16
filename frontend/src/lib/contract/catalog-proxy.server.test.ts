import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { suppressConsole } from "~/test/helpers/console";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./catalog-proxy.server";
import { success } from "./runtime";

const api = vi.fn();
let sessionReads = 0;

type Handler = (...args: unknown[]) => Promise<unknown>;

// Stands for the portal's handlers: each reads the session, then runs the
// handler with the session's token. makePortalHandlers has its own tests.
const noBody =
  (handler: Handler) =>
  async (request: NextRequest, context: { params: Promise<unknown> }) => {
    sessionReads++;
    return Response.json({
      data: await handler(request, "token", await context.params),
    });
  };
const withBody =
  (handler: Handler) =>
  async (request: NextRequest, context: { params: Promise<unknown> }) => {
    sessionReads++;
    const body: unknown = await request.json();
    return Response.json({
      data: await handler(request, body, "token", await context.params),
    });
  };
const portal = {
  get: noBody,
  del: noBody,
  post: withBody,
  put: withBody,
  patch: withBody,
  api,
} as unknown as Parameters<typeof makeCatalogProxy>[0];

const row = success(z.object({ name: z.string() }));
const routes: CatalogRoute[] = [
  { method: "GET", pattern: "/parent/rows/{id}", response: row },
  { method: "GET", pattern: "/parent/rows/mine", response: row },
  {
    method: "GET",
    pattern: "/parent/rows/",
    query: ["day", "group_id"],
    response: success(z.array(z.string())),
  },
  { method: "POST", pattern: "/parent/rows/", response: row },
  { method: "DELETE", pattern: "/parent/rows/{id}", response: row },
  // A legacy route with response variants has no single decoder.
  { method: "GET", pattern: "/parent/variants/", response: { full: row } },
  { method: "GET", pattern: "/parent/files/*", response: row },
];

function call(
  method: CatalogMethod,
  path: string[],
  search = "",
  body?: unknown,
) {
  const request = new NextRequest(
    `http://parents.localhost/api/parent/${path.join("/")}${search}`,
    {
      method,
      headers: { "Idempotency-Key": "key-1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return makeCatalogProxy(
    portal,
    "/parent",
    routes,
    method,
  )(request, {
    params: Promise.resolve({ path }),
  });
}

const data = async (response: Response) =>
  ((await response.json()) as { data: unknown }).data;

describe("makeCatalogProxy", () => {
  suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
    sessionReads = 0;
  });

  it("forwards a registered read and answers its decoded data", async () => {
    api.mockResolvedValueOnce({
      status: "success",
      data: { name: "Ada", more: 1 },
    });
    const response = await call("GET", ["rows", "a/b"], "?day=2026-09-09");
    expect(await data(response)).toEqual({ name: "Ada" });
    // The segment is encoded again, and this route registers no query.
    expect(api).toHaveBeenCalledExactlyOnceWith(
      "GET",
      "/parent/rows/a%2Fb",
      "token",
      undefined,
      { request: expect.any(NextRequest) },
    );
  });

  it("forwards only the registered query parameters, every occurrence", async () => {
    api.mockResolvedValueOnce({ status: "success", data: [] });
    await call(
      "GET",
      ["rows"],
      "?group_id=1&group_id=2&debug=1&day=2026-09-09",
    );
    expect(api.mock.calls[0]?.[1]).toBe(
      "/parent/rows?day=2026-09-09&group_id=1&group_id=2",
    );
  });

  it("prefers a literal segment over a parameter", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("GET", ["rows", "mine"]);
    expect(api.mock.calls[0]?.[1]).toBe("/parent/rows/mine");
  });

  it("keeps a decoded slash or question mark inside its one segment", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("GET", ["rows", "../mine?x=1"]);
    expect(api.mock.calls[0]?.[1]).toBe("/parent/rows/..%2Fmine%3Fx%3D1");
  });

  it.each([
    ["a path nothing registers", "GET", ["secrets"]],
    ["a registered path under another method", "PUT", ["rows", "1"]],
    ["a deeper path than the pattern", "GET", ["rows", "1", "notes"]],
    ["a dot segment in place of a parameter", "GET", ["rows", ".."]],
    ["a route with response variants", "GET", ["variants"]],
    ["a wildcard pattern", "GET", ["files", "a"]],
  ] as const)(
    "answers 404 for %s without reading the session",
    async (_name, method, path) => {
      const response = await call(
        method,
        [...path],
        "",
        method === "GET" ? undefined : {},
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(sessionReads).toBe(0);
      expect(api).not.toHaveBeenCalled();
    },
  );

  it("sends a write with its body and idempotency key", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    const response = await call("POST", ["rows"], "", { name: "Ada" });
    expect(await data(response)).toEqual({ name: "Ada" });
    expect(api).toHaveBeenCalledExactlyOnceWith(
      "POST",
      "/parent/rows",
      "token",
      { name: "Ada" },
      { idempotencyKey: "key-1", request: expect.any(NextRequest) },
    );
  });

  it("answers a DELETE without a body with nothing", async () => {
    api.mockResolvedValueOnce(undefined);
    expect(await data(await call("DELETE", ["rows", "1"]))).toBeNull();
    expect(sessionReads).toBe(1);
  });

  it("refuses an answer outside the contract with 502", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: 7 } });
    await expect(call("GET", ["rows", "1"])).rejects.toMatchObject({
      status: 502,
    });
  });

  it("refuses the empty answer of a read with 502", async () => {
    api.mockResolvedValueOnce(undefined);
    await expect(call("GET", ["rows", "1"])).rejects.toMatchObject({
      status: 502,
    });
  });
});
