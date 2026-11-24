import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TEST_CLOCK_INSTANT } from "~/test/clock";
import { ApiError } from "~/lib/api-error";
import { presentError } from "~/lib/error-presentation";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { suppressConsole } from "~/test/helpers/console";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "./catalog-proxy.server";
import { noData, paginated, success } from "./runtime";
import {
  CATALOG_OUTSIDE_MOUNTS,
  CATALOG_PUBLIC_OUTSIDE_MOUNTS,
} from "./catalog-outside-mounts";
import { portalRoutes } from "./portals.generated";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: async (
    endpoint: string,
    token: string,
    {
      method,
      json,
      request,
      idempotencyKey,
    }: import("~/lib/backend-client.server").BackendCall,
  ) => {
    const answer: unknown = await api(method, endpoint, token, json, {
      request,
      ...(idempotencyKey !== undefined && { idempotencyKey }),
    });
    if (answer instanceof Response) return answer;
    return answer === undefined
      ? new Response(null, { status: 204 })
      : Response.json(answer);
  },
}));
let sessionReads = 0;

type Handler = (...args: unknown[]) => Promise<unknown>;

// Stands for the portal's handlers: each reads the session, then runs the
// handler with the session's token and hands a Response on as it is.
// makePortalHandlers has its own tests; here each request records the
// options its handler was built with.
let usedOptions: unknown;
const answered = (result: unknown) =>
  result instanceof Response ? result : Response.json({ data: result });
const noBody =
  (handler: Handler, options?: unknown) =>
  async (request: NextRequest, context: { params: Promise<unknown> }) => {
    sessionReads++;
    usedOptions = options;
    return answered(await handler(request, "token", await context.params));
  };
const withBody =
  (handler: Handler, options?: unknown) =>
  async (request: NextRequest, context: { params: Promise<unknown> }) => {
    sessionReads++;
    usedOptions = options;
    // Like parseRequestBody: an empty body reads as {}.
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : {};
    return answered(
      await handler(request, body, "token", await context.params),
    );
  };
const portal = {
  get: noBody,
  delWithBody: withBody,
  post: withBody,
  put: withBody,
  patch: withBody,
} as unknown as Parameters<typeof makeCatalogProxy>[0];

const row = success(z.object({ name: z.string() }));
const routes: CatalogRoute[] = [
  { method: "GET", pattern: "/parent/rows/{id}", response: row },
  { method: "GET", pattern: "/parent/rows/mine", response: row },
  {
    method: "GET",
    pattern: "/parent/rows/",
    query: { day: { kind: "date" }, group_id: { kind: "id" } },
    response: success(z.array(z.string())),
  },
  { method: "POST", pattern: "/parent/rows/", response: row },
  { method: "DELETE", pattern: "/parent/rows/{id}", response: row },
  { method: "DELETE", pattern: "/parent/rows/{id}/seen", response: noData },
  { method: "PUT", pattern: "/parent/rows/{id}/seen", response: noData },
  // A legacy route with response variants has no single decoder.
  { method: "GET", pattern: "/parent/variants/", response: { full: row } },
  {
    method: "GET",
    pattern: "/parent/pages/",
    query: { page: { kind: "int" }, view: { kind: "string" } },
    variantParam: "view",
    defaultVariant: "full",
    response: {
      full: paginated(z.array(z.object({ name: z.string(), age: z.number() }))),
      names: paginated(z.array(z.object({ name: z.string() }))),
    },
  },
  { method: "GET", pattern: "/parent/files/*", response: row },
  {
    method: "POST",
    pattern: "/parent/codes",
    noRetryAfterRenewal: "a renewed session would mail the code twice",
    response: row,
  },
  {
    method: "POST",
    pattern: "/parent/batches",
    maxBodyBytes: 64,
    response: row,
  },
  // Backend paths beside the mount; the proxy reaches only the listed ones.
  { method: "GET", pattern: "/analytics-policy", response: row },
  { method: "GET", pattern: "/news-attachments/{id}", response: row },
  { method: "GET", pattern: "/unlisted/{id}", response: row },
  { method: "GET", pattern: "/rows/{id}", response: row },
];

const OUTSIDE = [
  "/analytics-policy",
  "/news-attachments",
  "/parent-x",
  "/rows",
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
    OUTSIDE,
  )(request, {
    params: Promise.resolve({ path }),
  });
}

const data = async (response: Response) =>
  ((await response.json()) as { data: unknown }).data;

function callTenant(path: string, query = "") {
  const handler = makeCatalogProxy(
    portal,
    "/api",
    portalRoutes.tenant,
    "GET",
    CATALOG_OUTSIDE_MOUNTS.tenant,
    {
      routes: portalRoutes.public,
      outside: CATALOG_PUBLIC_OUTSIDE_MOUNTS.tenant,
    },
  );
  return handler(
    new NextRequest(`http://school-a.localhost/api/${path}${query}`),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

describe("makeCatalogProxy", () => {
  suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
    sessionReads = 0;
    usedOptions = undefined;
  });

  it("forwards a registered read and answers its decoded data", async () => {
    api.mockResolvedValueOnce({
      status: "success",
      data: { name: "Ada", more: 1 },
      message: "found",
    });
    const response = await call("GET", ["rows", "a/b"], "?day=2026-09-09");
    // The backend's envelope with the decoded data and its message (#2353).
    expect(await response.json()).toEqual({
      status: "success",
      data: { name: "Ada" },
      message: "found",
    });
    // The segment is encoded again, and this route registers no query.
    expect(api).toHaveBeenCalledExactlyOnceWith(
      "GET",
      "/parent/rows/a%2Fb",
      "token",
      undefined,
      { request: expect.any(NextRequest) },
    );
  });

  describe("a route with response variants and pages", () => {
    const pagination = {
      current_page: 2,
      page_size: 1,
      total_pages: 3,
      total_records: 3,
    };

    it("decodes the variant the query asks for and keeps the page", async () => {
      api.mockResolvedValueOnce({
        status: "success",
        data: [{ name: "Ada", age: 7 }],
        pagination,
      });
      const response = await call("GET", ["pages"], "?view=names&page=2");
      // The names variant drops what it does not declare; the backend's
      // envelope passes on with its page.
      expect(await response.json()).toEqual({
        status: "success",
        data: [{ name: "Ada" }],
        pagination,
      });
      expect(api.mock.calls[0]?.[1]).toBe("/parent/pages?page=2&view=names");
    });

    it("holds an answer without the parameter to the default variant", async () => {
      api.mockResolvedValueOnce({
        status: "success",
        data: [{ name: "Ada" }],
        pagination,
      });
      await expect(call("GET", ["pages"])).rejects.toMatchObject({
        status: 502,
      });
    });

    it("holds an unknown variant to the default one", async () => {
      api.mockResolvedValueOnce({
        status: "success",
        data: [{ name: "Ada", age: 7 }],
        pagination,
      });
      const response = await call("GET", ["pages"], "?view=other");
      expect(await response.json()).toMatchObject({
        data: [{ name: "Ada", age: 7 }],
        pagination,
      });
    });
  });

  it("forwards only the registered query parameters, without validating their values", async () => {
    api.mockResolvedValueOnce({ status: "success", data: [] });
    await call(
      "GET",
      ["rows"],
      "?group_id=1&group_id=2&debug=1&day=not-a-date",
    );
    expect(api.mock.calls[0]?.[1]).toBe(
      "/parent/rows?day=not-a-date&group_id=1&group_id=2",
    );
  });

  it("prefers a literal segment over a parameter", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("GET", ["rows", "mine"]);
    expect(api.mock.calls[0]?.[1]).toBe("/parent/rows/mine");
  });

  it.each([
    ["students/123/documents", "attest", { student_id: "123" }],
    ["staff/123/documents", "arbeitsvertrag", { staff_id: "123" }],
  ])(
    "forwards the category filter for %s through the full tenant catalog",
    async (path, category, owner) => {
      const list = { ...owner, documents: [], visible_categories: [] };
      api.mockResolvedValueOnce({ status: "success", data: list });
      const response = await callTenant(path, `?category=${category}&debug=1`);

      expect(response.status).toBe(200);
      expect(await data(response)).toEqual(list);
      expect(api).toHaveBeenCalledExactlyOnceWith(
        "GET",
        `/api/${path}?category=${category}`,
        "token",
        undefined,
        { request: expect.any(NextRequest) },
      );
    },
  );

  it.each(["open", "history"])(
    "loads the %s enrollment review list through the full tenant catalog",
    async (view) => {
      const page = { items: [], next_cursor: "next-page" };
      api.mockResolvedValueOnce({ status: "success", data: page });
      const response = await callTenant(
        "enrollment/admin/change-requests/list",
        `?view=${view}&search=Kind&cursor=previous-page&debug=1`,
      );

      expect(response.status).toBe(200);
      expect(await data(response)).toEqual(page);
      expect(api.mock.calls[0]?.[1]).toBe(
        `/api/enrollment/admin/change-requests/list?cursor=previous-page&search=Kind&view=${view}`,
      );
    },
  );

  it.each([
    ["enrollment/admin/change-requests/pending-count", { pending_count: 3 }],
    ["enrollment/admin/requests/unread-count", { unread_count: 2 }],
  ])(
    "loads the counter at %s through the full tenant catalog",
    async (path, count) => {
      api.mockResolvedValueOnce({ status: "success", data: count });
      const response = await callTenant(path);
      expect(response.status).toBe(200);
      expect(await data(response)).toEqual(count);
    },
  );

  it("still loads an individual enrollment change request", async () => {
    const request = {
      id: "11",
      request_id: "12",
      origin: "parent",
      status: "pending",
      base_snapshot: null,
      proposed_snapshot: null,
      diff: null,
      created_at: TEST_CLOCK_INSTANT.toISOString(),
      updated_at: TEST_CLOCK_INSTANT.toISOString(),
    };
    api.mockResolvedValueOnce({ status: "success", data: request });
    const response = await callTenant("enrollment/admin/change-requests/11");
    expect(await data(response)).toEqual(request);
  });

  it("keeps legacy snapshot rows and consent values beside typed ones", async () => {
    api.mockResolvedValueOnce({
      status: "success",
      data: {
        id: "11",
        request_id: "12",
        origin: "parent",
        status: "pending",
        base_snapshot: {
          consent_flags: { photo: "true", trips: false },
          children: [
            "legacy child",
            { first_name: "Anna", previous_group: "1a" },
          ],
        },
        proposed_snapshot: null,
        diff: null,
        created_at: TEST_CLOCK_INSTANT.toISOString(),
        updated_at: TEST_CLOCK_INSTANT.toISOString(),
      },
    });
    const reply = await callTenant("enrollment/admin/change-requests/11");
    expect(reply.status).toBe(200);
    expect(await data(reply)).toMatchObject({
      base_snapshot: {
        consent_flags: { photo: "true", trips: false },
        children: [
          "legacy child",
          { first_name: "Anna", previous_group: "1a" },
        ],
      },
    });
  });

  it.each([
    ["enrollment/admin/change-requests/list", { items: [{}] }],
    ["enrollment/admin/change-requests/pending-count", { pending_count: "3" }],
  ])("rejects an invalid backend answer at %s", async (path, answer) => {
    api.mockResolvedValueOnce({ status: "success", data: answer });
    await expect(callTenant(path)).rejects.toMatchObject({ status: 502 });
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
    [
      "a path beside the mount the list does not name",
      "GET",
      ["unlisted", "1"],
    ],
    ["a listed head the contract does not register", "GET", ["parent-x"]],
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
      expect(await response.json()).toMatchObject({
        status: 404,
        code: "general.route_not_found",
      });
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
    expect(await data(await call("DELETE", ["rows", "1", "seen"]))).toBeNull();
    expect(sessionReads).toBe(1);
    expect(api.mock.calls[0]?.[3]).toBeUndefined();
  });

  it.each([
    ["POST", ["rows"], new Response('{"status":', { status: 201 })],
    ["DELETE", ["rows", "1"], new Response(null, { status: 204 })],
  ] as const)(
    "reports an unreadable %s answer after a successful write",
    async (method, segments, upstream) => {
      api.mockResolvedValueOnce(upstream);
      const refusal = await call(method, [...segments]).catch(
        (error: unknown) => error,
      );
      expect(refusal).toMatchObject({ status: 502 });
      expect((refusal as ApiResponseError).body()).toMatchObject({
        code: "general.write_answer_unreadable",
      });
      expect(api).toHaveBeenCalledTimes(1);
    },
  );

  it("sends the body of a DELETE that carries one", async () => {
    api.mockResolvedValueOnce(undefined);
    await call("DELETE", ["rows", "1", "seen"], "", { reason: "lost phone" });
    expect(api.mock.calls[0]?.[3]).toEqual({ reason: "lost phone" });
  });

  it.each([
    ["a 204", undefined],
    ["the envelope without data", { status: "success", message: "done" }],
  ])("answers a write without data for %s", async (_name, answer) => {
    api.mockResolvedValueOnce(answer);
    const response = await call("PUT", ["rows", "1", "seen"], "", { on: true });
    expect(await data(response)).toBeNull();
    expect(api.mock.calls[0]?.[3]).toEqual({ on: true });
  });

  it("refuses data on a route registered without data with 502", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await expect(
      call("PUT", ["rows", "1", "seen"], "", { on: true }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("asks to reload instead of resending a stored write whose answer leaves the contract", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    const refusal = await call("PUT", ["rows", "1", "seen"], "", {
      on: true,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiResponseError);
    expect((refusal as ApiResponseError).body()).toMatchObject({
      status: 502,
      code: "general.write_answer_unreadable",
    });
  });

  it.each([
    "students/care-end/preview",
    "students/care-withdrawals/7/care-end/preview",
  ])("keeps a failed catalog POST query retryable: %s", async (path) => {
    api.mockResolvedValueOnce({ status: "success", data: null });
    const handler = makeCatalogProxy(
      portal,
      "/api",
      portalRoutes.tenant,
      "POST",
    );
    const request = new NextRequest(`http://school-a.localhost/api/${path}`, {
      method: "POST",
      body: "{}",
    });
    const refusal: unknown = await handler(request, {
      params: Promise.resolve({ path: path.split("/") }),
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiResponseError);
    if (!(refusal instanceof ApiResponseError)) return;
    expect(refusal.body()).toMatchObject({
      status: 502,
      code: "general.unavailable",
    });
    expect(
      presentError(
        new ApiError(
          "Bad Gateway",
          refusal.status,
          refusal.body<{ code: string }>() ?? undefined,
        ),
        "Vorschau",
      ).retryable,
    ).toBe(true);
  });

  it("refuses an answer outside the contract with 502", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: 7 } });
    const refusal = await call("GET", ["rows", "1"]).catch(
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ status: 502 });
    // A read may be sent again.
    expect((refusal as ApiResponseError).body()).toMatchObject({
      code: "general.unavailable",
    });
  });

  it("refuses the empty answer of a read with 502", async () => {
    api.mockResolvedValueOnce(undefined);
    await expect(call("GET", ["rows", "1"])).rejects.toMatchObject({
      status: 502,
    });
  });

  it("runs a route with the no-retry trait once, also after a renewal", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("POST", ["codes"], "", {});
    expect(usedOptions).toEqual({
      retry: { off: "a renewed session would mail the code twice" },
    });
  });

  it("bounds the body of a route with a body limit", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("POST", ["batches"], "", { ids: ["1"] });
    expect(usedOptions).toEqual({ maxBodyBytes: 64 });
  });

  it("keeps the portal's defaults for a route without traits", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("POST", ["rows"], "", { name: "Ada" });
    expect(usedOptions).toEqual({});
  });

  it.each([
    [["analytics-policy"], "/analytics-policy"],
    [["news-attachments", "7"], "/news-attachments/7"],
  ])(
    "reaches the listed backend path %j beside the mount",
    async (path, endpoint) => {
      api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
      const response = await call("GET", path);
      expect(await data(response)).toEqual({ name: "Ada" });
      expect(api.mock.calls[0]?.[1]).toBe(endpoint);
    },
  );

  it("prefers the route under the mount over one beside it", async () => {
    api.mockResolvedValueOnce({ status: "success", data: { name: "Ada" } });
    await call("GET", ["rows", "1"]);
    expect(api.mock.calls[0]?.[1]).toBe("/parent/rows/1");
  });
});
