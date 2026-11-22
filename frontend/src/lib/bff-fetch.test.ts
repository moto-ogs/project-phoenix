import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFetch, mockTransportFetch } = vi.hoisted(() => ({
  mockSessionFetch:
    vi.fn<
      (
        url: string,
        init?: RequestInit,
        options?: { authRefusals?: readonly string[] },
      ) => Promise<Response>
    >(),
  mockTransportFetch:
    vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("./session-cache", () => ({ sessionFetch: mockSessionFetch }));
vi.mock("./api-error", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-error")>()),
  transportFetch: mockTransportFetch,
}));

import { ApiError } from "./api-error";
import { bffJson, bffPath } from "./bff-fetch";

const ok = (data: unknown, extra: object = {}) =>
  Response.json({ status: "success", data, ...extra });

beforeEach(() => {
  mockSessionFetch.mockReset();
  mockTransportFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bffPath", () => {
  it("puts the pattern below the portal's BFF prefix", () => {
    expect(bffPath("tenant", "/api/activities/categories")).toBe(
      "/api/activities/categories",
    );
    expect(bffPath("org", "/traeger/absence-types/")).toBe(
      "/api/traeger/absence-types",
    );
    expect(bffPath("platform", "/operator/stats")).toBe("/api/operator/stats");
  });

  it("puts a route outside the portal's mount below the prefix as a whole", () => {
    expect(bffPath("parent", "/analytics-policy")).toBe(
      "/api/parent/analytics-policy",
    );
    expect(bffPath("tenant", "/analytics-consent")).toBe(
      "/api/analytics-consent",
    );
  });

  it("encodes parameters and drops empty query values", () => {
    expect(
      bffPath(
        "tenant",
        "/api/activities/categories/{categoryId}",
        { categoryId: "a/b" },
        { include_archived: true, empty: undefined, ids: ["1", "2"] },
      ),
    ).toBe(
      "/api/activities/categories/a%2Fb?include_archived=true&ids=1&ids=2",
    );
  });

  it("refuses a missing parameter instead of calling another path", () => {
    expect(() => bffPath("tenant", "/api/activities/{id}", {})).toThrow(
      "missing path parameter id",
    );
  });
});

describe("bffJson", () => {
  it("returns the data of the answer, typed by the route", async () => {
    mockSessionFetch.mockResolvedValueOnce(ok([{ id: "7", name: "Sport" }]));

    const rows = await bffJson("tenant", "GET /api/activities/categories", {
      query: { include_archived: true },
    });

    const first: string | undefined = rows[0]?.id;
    expect(first).toBe("7");
    expect(mockSessionFetch).toHaveBeenCalledWith(
      "/api/activities/categories?include_archived=true",
      { method: "GET" },
    );
  });

  it("sends a JSON body serialized and a FormData body as is", async () => {
    mockSessionFetch
      .mockResolvedValueOnce(ok({ id: "1", name: "A" }))
      .mockResolvedValueOnce(ok({ id: "1" }));
    const form = new FormData();

    await bffJson("tenant", "PUT /api/activities/categories/{categoryId}", {
      params: { categoryId: "1" },
      body: { name: "A" },
    });
    await bffJson("tenant", "POST /api/students/{id}/photo", {
      params: { id: "4" },
      body: form,
    });

    const [, json] = mockSessionFetch.mock.calls[0] ?? [];
    expect(json).toMatchObject({
      method: "PUT",
      body: '{"name":"A"}',
      headers: { "Content-Type": "application/json" },
    });
    const [url, multipart] = mockSessionFetch.mock.calls[1] ?? [];
    expect(url).toBe("/api/students/4/photo");
    expect(multipart?.body).toBe(form);
    expect(multipart?.headers).toBeUndefined();
  });

  it("resolves a 204 and an answer without data to null", async () => {
    mockSessionFetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(ok(null));

    const args = [
      "tenant",
      "DELETE /api/activities/{id}",
      { params: { id: "3" } },
    ] as const;
    await expect(bffJson(...args)).resolves.toBeNull();
    await expect(bffJson(...args)).resolves.toBeNull();
  });

  it("returns data and pagination of a paginated list", async () => {
    const pagination = {
      current_page: 1,
      page_size: 50,
      total_pages: 1,
      total_records: 0,
    };
    mockSessionFetch.mockResolvedValueOnce(ok([], { pagination }));

    const page = await bffJson("tenant", "GET /api/groups/", {
      query: { page: 1 },
    });

    expect(page).toEqual({ data: [], pagination });
  });

  it("returns the variant the query names", async () => {
    mockSessionFetch.mockResolvedValue(
      ok([{ id: "1", first_name: "A", last_name: "B" }], {
        pagination: {
          current_page: 1,
          page_size: 50,
          total_pages: 1,
          total_records: 1,
        },
      }),
    );

    const names = await bffJson("tenant", "GET /api/students/", {
      query: { view: "names", page: 1 },
    });

    const first: { first_name: string } | undefined = names.data[0];
    expect(first?.first_name).toBe("A");
    expect(mockSessionFetch).toHaveBeenCalledWith(
      "/api/students?view=names&page=1",
      { method: "GET" },
    );
  });

  it("turns a refusal into an ApiError with the envelope and the caller's text", async () => {
    mockSessionFetch.mockResolvedValueOnce(
      Response.json(
        {
          status: 409,
          detail: "stale",
          code: "students.companions_changed",
          instance: "req-1",
          errors: [{ field: "x", reason: "stale" }],
        },
        { status: 409 },
      ),
    );

    const error = await bffJson("tenant", "GET /api/activities/categories", {
      errorMessage: "Kategorien konnten nicht geladen werden",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "Kategorien konnten nicht geladen werden",
      status: 409,
      code: "students.companions_changed",
      detail: "stale",
      requestId: "req-1",
      errors: [{ field: "x", reason: "stale" }],
    });
  });

  it("refuses a success without data as an unreadable answer", async () => {
    mockSessionFetch
      .mockResolvedValueOnce(Response.json({ id: "7" }))
      .mockResolvedValueOnce(Response.json({ status: "success" }));

    await expect(
      bffJson("tenant", "GET /api/activities/categories"),
    ).rejects.toMatchObject({ status: 502, code: "general.unavailable" });
    await expect(
      bffJson("tenant", "PUT /api/activities/categories/{categoryId}", {
        params: { categoryId: "1" },
        body: {},
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "general.write_answer_unreadable",
    });
  });

  it("passes signal and tenant auth refusals to the session fetch", async () => {
    const controller = new AbortController();
    mockSessionFetch.mockResolvedValueOnce(ok([]));

    await bffJson("tenant", "GET /api/activities/categories", {
      signal: controller.signal,
      authRefusals: ["identity.session_tenant_mismatch"],
    });

    const [, init, options] = mockSessionFetch.mock.calls[0] ?? [];
    expect(init?.signal).toBe(controller.signal);
    expect(options).toEqual({
      authRefusals: ["identity.session_tenant_mismatch"],
    });
  });

  it("sends the other portals with their cookie and without a cache", async () => {
    mockTransportFetch.mockResolvedValueOnce(ok([]));

    await bffJson("org", "GET /traeger/absence-types/");

    expect(mockTransportFetch).toHaveBeenCalledWith(
      "/api/traeger/absence-types",
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      },
    );
    expect(mockSessionFetch).not.toHaveBeenCalled();
  });

  it("sends the operator to the login on a 401", async () => {
    const location = { pathname: "/operator/schools", href: "" };
    vi.stubGlobal("window", { location });
    mockTransportFetch.mockResolvedValueOnce(
      Response.json({ status: 401 }, { status: 401 }),
    );

    await expect(
      bffJson("platform", "GET /operator/stats"),
    ).rejects.toMatchObject({ status: 401, message: "Session expired" });
    expect(location.href).toBe("/operator/login");
  });

  it("sends parents to the login on a 401 and throws the backend's error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    mockTransportFetch.mockResolvedValueOnce(
      Response.json(
        { status: 401, code: "general.permission" },
        { status: 401 },
      ),
    );

    await expect(
      bffJson("parent", "GET /analytics-policy"),
    ).rejects.toMatchObject({
      status: 401,
      code: "general.permission",
    });
    expect(assign).toHaveBeenCalledWith("/parents/login");
  });

  it("leaves Träger, moto schule and caterer on the page on a 401", async () => {
    mockTransportFetch.mockResolvedValueOnce(
      Response.json({ status: 401 }, { status: 401 }),
    );

    await expect(
      bffJson("org", "GET /traeger/absence-types/"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("checks route, parameters and body against the contract", () => {
    // Compile-time checks only: the function is never called.
    const checks = () => {
      // The examples of docs/agents/frontend-api.md#browser-calls.
      void bffJson("parent", "GET /parent/me/children");
      void bffJson("school", "GET /school/calendar/my");
      void bffJson("org", "POST /traeger/absence-types/", { body: {} });
      void bffJson("caterer", "GET /caterer/schools/{schoolId}/orders", {
        params: { schoolId: "1" },
        query: { from: "2026-09-01", to: "2026-09-30" },
      });
      void bffJson("platform", "GET /operator/stats");
      void bffJson("tenant", "GET /api/students/", {
        // @ts-expect-error: the route has no such variant
        query: { view: "wide" },
      });
      // @ts-expect-error: the route belongs to the Träger portal
      void bffJson("tenant", "GET /traeger/absence-types/");
      // @ts-expect-error: the path parameter is missing
      void bffJson("tenant", "DELETE /api/activities/{id}");
      void bffJson("tenant", "GET /api/activities/categories", {
        // @ts-expect-error: the route reads no such query parameter
        query: { name: "x" },
      });
      void bffJson("tenant", "PUT /api/activities/categories/{categoryId}", {
        params: { categoryId: "1" },
        // @ts-expect-error: the request type has no such field
        body: { title: "x" },
      });
    };
    expect(checks).toBeTypeOf("function");
  });
});
