import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch, mockRequireSession, mockRenewSession } = vi.hoisted(() => ({
  mockFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  mockRequireSession: vi.fn<() => Promise<void>>(),
  mockRenewSession: vi.fn<() => Promise<void>>(),
}));

// The session gate and its renewal are session-cache.test.ts's cases; here
// they are seams that let the request through or renew on demand.
vi.mock("./session-cache", () => ({
  requireTenantSession: mockRequireSession,
  renewTenantSession: mockRenewSession,
}));

import { ApiError } from "./api-error";
import { bffFile, bffJson, bffPath } from "./bff-fetch";

const ok = (data: unknown, extra: object = {}) =>
  Response.json({ status: "success", data, ...extra });

beforeEach(() => {
  mockFetch.mockReset();
  mockRequireSession.mockReset().mockResolvedValue(undefined);
  mockRenewSession.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", mockFetch);
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

  it("puts a public pattern below /api unless it is there already", () => {
    expect(
      bffPath("public", "/caterer/invitations/{schoolId}/{token}", {
        schoolId: "3",
        token: "t",
      }),
    ).toBe("/api/caterer/invitations/3/t");
    expect(bffPath("public", "/auth/password-reset")).toBe(
      "/api/auth/password-reset",
    );
    expect(
      bffPath("public", "/api/enrollment/phases/public/{tenantSlug}", {
        tenantSlug: "ogs",
      }),
    ).toBe("/api/enrollment/phases/public/ogs");
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

describe("bffFile", () => {
  it("hands the file answer to the caller", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("pdf", { headers: { "Content-Disposition": "x.pdf" } }),
    );

    const response = await bffFile(
      "tenant",
      "GET /api/meal-plan/orders/month/export",
      { query: { month: "2026-09", format: "pdf" } },
    );

    await expect(response.text()).resolves.toBe("pdf");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/meal-plan/orders/month/export?month=2026-09&format=pdf",
      { method: "GET" },
    );
  });

  it("sends the body of a file route that takes one", async () => {
    mockFetch.mockResolvedValueOnce(new Response("xlsx"));

    await bffFile("tenant", "POST /api/students/export", {
      body: { format: "xlsx" },
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/students/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"format":"xlsx"}',
    });
  });

  it("turns a refused file into the ApiError with the caller's text", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ code: "general.permission" }, { status: 403 }),
    );

    await expect(
      bffFile("tenant", "GET /api/meal-plan/orders/month/export", {
        errorMessage: "Export fehlgeschlagen",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "general.permission",
      message: "Export fehlgeschlagen",
    });
  });

  it("takes only file routes", () => {
    const checks = () => {
      // @ts-expect-error: a JSON route goes through bffJson
      void bffFile("tenant", "GET /api/activities/categories");
      const exportOrders = "GET /api/meal-plan/orders/month/export";
      // @ts-expect-error: month is a string, not a number
      void bffFile("tenant", exportOrders, { query: { month: 202609 } });
      // @ts-expect-error: the route registers only pdf and xlsx
      void bffFile("tenant", exportOrders, { query: { format: "csv" } });
    };
    expect(checks).toBeTypeOf("function");
  });
});

describe("bffJson", () => {
  it("returns the data of the answer, typed by the route", async () => {
    mockFetch.mockResolvedValueOnce(ok([{ id: "7", name: "Sport" }]));

    const rows = await bffJson("tenant", "GET /api/activities/categories", {
      query: { include_archived: true },
    });

    const first: string | undefined = rows[0]?.id;
    expect(first).toBe("7");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/activities/categories?include_archived=true",
      { method: "GET" },
    );
  });

  it("sends a JSON body serialized and a FormData body as is", async () => {
    mockFetch
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

    const [, json] = mockFetch.mock.calls[0] ?? [];
    expect(json).toMatchObject({
      method: "PUT",
      body: '{"name":"A"}',
      headers: { "Content-Type": "application/json" },
    });
    const [url, multipart] = mockFetch.mock.calls[1] ?? [];
    expect(url).toBe("/api/students/4/photo");
    expect(multipart?.body).toBe(form);
    expect(multipart?.headers).toBeUndefined();
  });

  it("resolves a 204 and an answer without data to null", async () => {
    mockFetch
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
    mockFetch.mockResolvedValueOnce(ok([], { pagination }));

    const page = await bffJson("tenant", "GET /api/groups/", {
      query: { page: 1 },
    });

    expect(page).toEqual({ data: [], pagination });
  });

  it("returns the variant the query names", async () => {
    mockFetch.mockResolvedValue(
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
    expect(mockFetch).toHaveBeenCalledWith("/api/students?view=names&page=1", {
      method: "GET",
    });
  });

  it("turns a refusal into an ApiError with the envelope and the caller's text", async () => {
    mockFetch.mockResolvedValueOnce(
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

  it("carries the wait of a refused request (Retry-After) on the ApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json(
        { status: 429, code: "general.rate_limited" },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    );

    await expect(
      bffJson("public", "GET /auth/invitations/{token}", {
        params: { token: "t" },
      }),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
  });

  it("refuses a success without data as an unreadable answer", async () => {
    mockFetch
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

  it("preserves AbortError when cancelled while consuming the response body", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Request aborted", "AbortError");
    const stream = new ReadableStream(
      {
        pull(streamController) {
          controller.abort(abortError);
          streamController.error(controller.signal.reason);
        },
      },
      { highWaterMark: 0 },
    );
    mockFetch.mockResolvedValueOnce(new Response(stream));

    await expect(
      bffJson("tenant", "GET /api/activities/categories", {
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
  });

  it("still reports malformed JSON as an unreadable answer", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not JSON"));

    await expect(
      bffJson("tenant", "GET /api/activities/categories"),
    ).rejects.toMatchObject({ status: 502, code: "general.unavailable" });
  });

  it("lets a cleanup outlive the page with keepalive", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await bffJson(
      "org",
      "DELETE /traeger/holiday-periods/{id}/form/documents/{documentId}",
      { params: { id: "3", documentId: "9" }, keepalive: true },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/traeger/holiday-periods/3/form/documents/9",
      {
        method: "DELETE",
        keepalive: true,
        credentials: "include",
        cache: "no-store",
      },
    );
  });

  it("starts a tenant keepalive cleanup before a pending session lookup can finish", async () => {
    let finishLookup!: () => void;
    mockRequireSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishLookup = resolve;
      }),
    );
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const cleanup = bffJson(
      "tenant",
      "DELETE /api/enrollment/legal-documents/{filename}",
      { params: { filename: "draft.pdf" }, keepalive: true },
    );
    const callsBeforeUnload = [...mockFetch.mock.calls];
    finishLookup();
    await cleanup;

    expect(callsBeforeUnload).toEqual([
      [
        "/api/enrollment/legal-documents/draft.pdf",
        { method: "DELETE", keepalive: true },
      ],
    ]);
    expect(mockRequireSession).not.toHaveBeenCalled();
  });

  it("surfaces a refused keepalive cleanup without a session renewal or retry", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ code: "general.permission" }, { status: 401 }),
    );

    await expect(
      bffJson("tenant", "DELETE /api/enrollment/legal-documents/{filename}", {
        params: { filename: "draft.pdf" },
        keepalive: true,
      }),
    ).rejects.toMatchObject({ status: 401, code: "general.permission" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRequireSession).not.toHaveBeenCalled();
    expect(mockRenewSession).not.toHaveBeenCalled();
  });

  it("passes the signal to the request", async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(ok([]));

    await bffJson("tenant", "GET /api/activities/categories", {
      signal: controller.signal,
    });

    const [, init] = mockFetch.mock.calls[0] ?? [];
    expect(init?.signal).toBe(controller.signal);
  });

  it("checks the staff session before the request goes out", async () => {
    mockRequireSession.mockRejectedValueOnce(
      new ApiError("Authentication required", 401, {
        code: "general.permission",
      }),
    );

    await expect(
      bffJson("tenant", "GET /api/activities/categories"),
    ).rejects.toMatchObject({ status: 401, code: "general.permission" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renews the staff session once on a 401 and repeats the request", async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ status: 401 }, { status: 401 }))
      .mockResolvedValueOnce(ok([]));

    await expect(
      bffJson("tenant", "GET /api/activities/categories"),
    ).resolves.toEqual([]);
    expect(mockRenewSession).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("ends with the renewal's refusal when the session cannot be renewed", async () => {
    mockFetch.mockResolvedValue(
      Response.json({ status: 401 }, { status: 401 }),
    );
    mockRenewSession.mockRejectedValueOnce(
      new ApiError("Authentication required", 401, {
        code: "general.permission",
      }),
    );

    await expect(
      bffJson("tenant", "GET /api/activities/categories"),
    ).rejects.toMatchObject({ status: 401, code: "general.permission" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("leaves the session alone on an operation's own auth refusal", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json(
        { status: 401, code: "identity.session_tenant_mismatch" },
        { status: 401 },
      ),
    );

    await expect(
      bffJson("tenant", "GET /api/activities/categories", {
        authRefusals: ["identity.session_tenant_mismatch"],
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "identity.session_tenant_mismatch",
    });
    expect(mockRenewSession).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("turns a request that never reached the BFF into general.unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await bffJson("org", "GET /traeger/absence-types/").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      code: "general.unavailable",
      noResponse: true,
    });
  });

  it("keeps an AbortError that is not an Error instance", async () => {
    const abort = { name: "AbortError", message: "Request aborted" };
    mockFetch.mockRejectedValueOnce(abort);

    await expect(bffJson("org", "GET /traeger/absence-types/")).rejects.toBe(
      abort,
    );
  });

  it("keeps a cancelled request an AbortError", async () => {
    const abort = new DOMException("aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abort);

    await expect(bffJson("org", "GET /traeger/absence-types/")).rejects.toBe(
      abort,
    );
  });

  it("sends the other portals with their cookie and without a cache", async () => {
    mockFetch.mockResolvedValueOnce(ok([]));

    await bffJson("org", "GET /traeger/absence-types/");

    expect(mockFetch).toHaveBeenCalledWith("/api/traeger/absence-types", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    expect(mockRequireSession).not.toHaveBeenCalled();
  });

  it("sends the operator to the login on a 401", async () => {
    const location = { pathname: "/operator/schools", href: "" };
    vi.stubGlobal("window", { location });
    mockFetch.mockResolvedValueOnce(
      Response.json({ status: 401 }, { status: 401 }),
    );

    await expect(
      bffJson("platform", "GET /operator/stats"),
    ).rejects.toMatchObject({ status: 401, message: "Session expired" });
    expect(location.href).toBe("/operator/login");
  });

  it("keeps the operator on the page for an operation's own refusal", async () => {
    const location = { pathname: "/operator/account", href: "" };
    vi.stubGlobal("window", { location });
    mockFetch.mockResolvedValueOnce(
      Response.json(
        { status: 401, code: "identity.mfa_code_invalid" },
        { status: 401 },
      ),
    );

    await expect(
      bffJson("platform", "GET /operator/stats", {
        authRefusals: ["identity.mfa_code_invalid"],
      }),
    ).rejects.toMatchObject({ status: 401, code: "identity.mfa_code_invalid" });
    expect(location.href).toBe("");
  });

  it("sends parents to the login on a 401 and throws the backend's error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    mockFetch.mockResolvedValueOnce(
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

  it("sends a public route without a session", async () => {
    mockFetch.mockResolvedValueOnce(ok({ valid: true }));

    await bffJson("public", "GET /traeger/invitations/{token}", {
      params: { token: "abc" },
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/traeger/invitations/abc", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    expect(mockRequireSession).not.toHaveBeenCalled();
  });

  it("leaves Träger, moto schule and caterer on the page on a 401", async () => {
    mockFetch.mockResolvedValueOnce(
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
      // @ts-expect-error: the route has no such variant
      void bffJson("tenant", "GET /api/students/", { query: { view: "wide" } });
      // @ts-expect-error: the route belongs to the Träger portal
      void bffJson("tenant", "GET /traeger/absence-types/");
      // A route its own route.ts serves, with the backend's answer.
      void bffJson("tenant", "GET /api/settings/login-image");
      // @ts-expect-error: a session step answers the BFF's own shape
      void bffJson("tenant", "POST /auth/login", { body: {} });
      // @ts-expect-error: the wall display answers without the envelope
      void bffJson("tenant", "GET /api/display/dashboard");
      // @ts-expect-error: the path parameter is missing
      void bffJson("tenant", "DELETE /api/activities/{id}");
      const partialAbsences = "GET /api/students/{id}/partial-absences";
      const student = { id: "7" };
      void bffJson("tenant", partialAbsences, {
        params: student,
        query: { from: "2026-09-01", to: "2026-09-30" },
      });
      void bffJson("tenant", partialAbsences, {
        params: student,
        // @ts-expect-error: from is a date string, not a number
        query: { from: 5 },
      });
      const groups = "GET /api/groups/";
      // @ts-expect-error: page is a number, not pre-serialized text
      void bffJson("tenant", groups, { query: { page: "1" } });
      const rooms = "GET /api/rooms/";
      // @ts-expect-error: is_open_room is a boolean, not pre-serialized text
      void bffJson("tenant", rooms, { query: { is_open_room: "true" } });
      const careUsage = "GET /api/enrollment/admin/reports/care-usage";
      void bffJson("tenant", careUsage, {
        query: { phase_id: "7", care_offering_ids: ["1", "2"] },
      });
      // @ts-expect-error: IDs are strings
      void bffJson("tenant", careUsage, { query: { phase_id: 7 } });
      // @ts-expect-error: a repeated parameter takes an array
      void bffJson("tenant", careUsage, { query: { care_offering_ids: "1" } });
      const getCategories = "GET /api/activities/categories";
      // @ts-expect-error: the route reads no such query parameter
      void bffJson("tenant", getCategories, { query: { name: "x" } });
      const putCategory = "PUT /api/activities/categories/{categoryId}";
      const params = { categoryId: "1" };
      // @ts-expect-error: the request type has no such field
      void bffJson("tenant", putCategory, { params, body: { title: "x" } });
    };
    expect(checks).toBeTypeOf("function");
  });
});
