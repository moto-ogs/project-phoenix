import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleDomainApiError } from "./api-helpers";
import { ApiError, errorClassCode, problemTitle } from "./api-error";
import {
  handleApiError,
  apiGet,
  apiPost,
  bffError,
  problemResponse,
  ApiResponseError as ServerApiResponseError,
} from "./api-helpers.server";
import { suppressConsole } from "~/test/helpers/console";

const { mockNextHeaders } = vi.hoisted(() => ({
  mockNextHeaders: vi.fn(),
}));

const { mockRecordBackendProxyMetric } = vi.hoisted(() => ({
  mockRecordBackendProxyMetric: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mockNextHeaders,
}));

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://backend.test",
}));

vi.mock("./backend-proxy-metrics", () => ({
  recordBackendProxyMetric: mockRecordBackendProxyMetric,
}));

describe("ApiResponseError", () => {
  it("parses JSON response bodies lazily and memoizes the result", () => {
    const error = new ServerApiResponseError(
      403,
      JSON.stringify({ detail: "feature_disabled", code: "feedback.disabled" }),
    );

    expect(error.status).toBe(403);
    expect(error.body<{ detail: string }>()).toEqual({
      detail: "feature_disabled",
      code: "feedback.disabled",
    });
    expect(error.body<{ detail: string }>()).toEqual({
      detail: "feature_disabled",
      code: "feedback.disabled",
    });
  });

  it("returns null for non-JSON response bodies", () => {
    const error = new ServerApiResponseError(500, "plain backend failure");

    expect(error.body()).toBeNull();
    expect(error.body()).toBeNull();
  });

  it("preserves Retry-After on a rate-limit error", () => {
    const error = new ServerApiResponseError(429, "slow down", {
      retryAfter: "17",
    });

    expect(error.retryAfter).toBe("17");
  });
});

describe("handleApiError", () => {
  const consoleSpies = suppressConsole("error", "warn");

  function backendError(status: number, body: unknown, retryAfter?: string) {
    const envelope = {
      type: "about:blank",
      title: problemTitle(status),
      status,
      detail: problemTitle(status),
      instance: "request-1",
      code: errorClassCode(status),
      ...(body as Record<string, unknown>),
    };
    return new ServerApiResponseError(status, JSON.stringify(envelope), {
      contentType: "application/problem+json",
      retryAfter,
    });
  }

  it("forwards the backend envelope with its status unchanged", async () => {
    const envelope = {
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "account already has access to tenant",
      instance: "req-1",
      code: "identity.account_already_has_tenant_access",
    };

    const response = handleApiError(backendError(409, envelope));

    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    expect(await response.json()).toEqual(envelope);
  });

  it("forwards Retry-After from a backend 429", () => {
    const response = handleApiError(
      new ServerApiResponseError(429, "rate limited", { retryAfter: "17" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
  });

  it("wraps a non-JSON backend body in an envelope with the class code", async () => {
    const response = handleApiError(
      new ServerApiResponseError(502, "<html>Bad Gateway</html>"),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      status: 502,
      detail: "Bad Gateway",
      code: "general.unavailable",
    });
  });

  // F3: nothing an upstream proxy, an exception or this server's own
  // diagnostics wrote may reach the browser. The cause stays in the log.
  it("does not forward a non-JSON upstream body to the browser", async () => {
    const response = handleApiError(
      new ServerApiResponseError(502, "<html>secret upstream</html>"),
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 502,
      detail: "Bad Gateway",
      code: "general.unavailable",
    });
    expect(body).not.toContain("secret upstream");
  });

  it("does not forward a valid backend 5xx envelope to the browser", async () => {
    const response = handleApiError(
      backendError(500, {
        detail: "database host db.internal refused the connection",
        code: "general.server",
        details: { host: "db.internal" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "general.server",
    });
    expect(body).not.toContain("db.internal");
    expect(body).not.toContain("refused the connection");
  });

  it("adds the request ID to a sanitized backend error", async () => {
    const response = handleApiError(
      new ServerApiResponseError(502, "upstream diagnostics"),
      new Request("https://frontend.test/api/example", {
        headers: { "X-Request-ID": "request-502" },
      }),
    );

    expect(await response.json()).toMatchObject({
      status: 502,
      instance: "request-502",
    });
  });

  it("preserves a registered backend 5xx code while sanitizing diagnostics", async () => {
    const response = handleApiError(
      backendError(500, {
        detail: "database host db.internal refused the connection",
        code: "iot.schulhof_not_configured",
        details: { host: "db.internal" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "iot.schulhof_not_configured",
    });
    expect(body).not.toContain("db.internal");
  });

  it.each(["backend", "local"])(
    "sanitizes nested import diagnostics through the %s error path",
    async (source) => {
      const result = {
        total_rows: 3,
        created_count: 1,
        updated_count: 1,
        error_count: 1,
        errors: [
          {
            row_number: 4,
            data: { first_name: "Ada" },
            errors: [
              {
                field: "creation",
                code: "creation_failed",
                severity: "error",
                message: "database db.internal: constraint failed",
              },
              {
                field: "last_name",
                code: "required",
                severity: "error",
                message: "Bitte gib den Nachnamen ein.",
              },
            ],
          },
        ],
      };
      const details = {
        result,
        rejection: {
          code: "students.child_quota_exceeded",
          details: { limit: 5 },
        },
      };
      const code = "import.import_batch_failed";
      const response =
        source === "backend"
          ? handleApiError(backendError(500, { code, details }))
          : problemResponse(500, "write failed", { code, details });
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({
        code,
        details: {
          ...details,
          result: {
            ...result,
            errors: [
              {
                ...result.errors[0],
                errors: [
                  {
                    ...result.errors[0]!.errors[0],
                    message:
                      "Die Zeile konnte nicht gespeichert werden. Bitte versuche es erneut.",
                  },
                  result.errors[0]!.errors[1],
                ],
              },
            ],
          },
        },
      });
      expect(body).not.toContain("db.internal");
      expect(details.result.errors[0]!.errors[0]!.message).toContain(
        "db.internal",
      );
    },
  );

  it("replaces an incomplete JSON backend error with a class envelope", async () => {
    const response = handleApiError(
      new ServerApiResponseError(
        400,
        JSON.stringify({ error: "upstream validation diagnostics" }),
        { contentType: "application/problem+json" },
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 400,
      detail: "Bad Request",
      code: "general.input",
    });
    expect(body).not.toContain("upstream validation diagnostics");
  });

  it("keeps an unknown error's message in the log, not in the response", async () => {
    const response = handleApiError(new Error("db password wrong at 10.0.0.5"));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "general.server",
    });
    expect(body).not.toContain("db password wrong at 10.0.0.5");
    expect(JSON.stringify(consoleSpies.error.mock.calls)).toContain(
      "db password wrong at 10.0.0.5",
    );
  });

  it("answers an ApiError with its code but without its diagnostic message", async () => {
    const response = handleApiError(
      new ApiError("internal diag", 409, {
        code: "students.change_request_stale",
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 409,
      code: "students.change_request_stale",
    });
    expect(body).not.toContain("internal diag");
  });

  it("replaces an unregistered ApiError code with its status class", async () => {
    const response = handleApiError(
      new ApiError("upstream diagnostic", 409, {
        code: "upstream.unknown_code",
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 409,
      code: "general.business_rejection",
    });
    expect(body).not.toContain("upstream diagnostic");
    expect(body).not.toContain("upstream.unknown_code");
  });

  // A plain Error whose text happens to look like the old
  // "API error (403)" shape carries no status: the text never decides.
  it("never reads a status out of the message", async () => {
    const response = handleApiError(new Error("API error (403): Forbidden"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("answers an ApiError with its status, code and payload", async () => {
    const error = new ApiError("bad date", 400, {
      code: "general.input",
      errors: [{ field: "date", reason: "invalid" }],
      details: { field: "date" },
    });

    const response = handleApiError(error);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 400,
      detail: "Bad Request",
      code: "general.input",
      errors: [{ field: "date", reason: "invalid" }],
      details: { field: "date" },
    });
  });

  it("strips diagnostic ApiError extensions from a 5xx response", async () => {
    const response = handleApiError(
      new ApiError("database host db.internal refused the connection", 503, {
        code: "iot.schulhof_not_configured",
        errors: [{ field: "database_password", reason: "secret" }],
        details: { host: "db.internal", password: "secret" },
        instance: "request-503",
      }),
    );

    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 503,
      detail: "Service Unavailable",
      code: "iot.schulhof_not_configured",
      instance: "request-503",
    });
    expect(body).not.toContain("database_password");
    expect(body).not.toContain("db.internal");
    expect(body).not.toContain("secret");
  });

  it("adds the request ID to frontend-generated errors", async () => {
    const response = handleApiError(
      new ApiError("bad date", 400),
      new Request("https://frontend.test/api/example", {
        headers: { "X-Request-ID": "request-400" },
      }),
    );

    expect(await response.json()).toMatchObject({
      status: 400,
      instance: "request-400",
    });
  });

  it("adds the request ID to BFF errors forwarded by the route wrapper", async () => {
    const response = handleApiError(
      bffError(400, "request body is not valid JSON"),
      new Request("https://frontend.test/api/example", {
        headers: { "X-Request-ID": "request-bff" },
      }),
    );

    expect(await response.json()).toMatchObject({
      status: 400,
      instance: "request-bff",
    });
  });

  it("adds the request ID to a directly constructed problem response", async () => {
    const response = problemResponse(
      400,
      "Invalid JSON",
      undefined,
      new Request("https://frontend.test/api/example", {
        headers: { "X-Request-ID": "request-direct" },
      }),
      undefined,
    );

    expect(await response.json()).toMatchObject({
      status: 400,
      instance: "request-direct",
    });
  });

  it("logs error for 5xx status codes", () => {
    handleApiError(backendError(500, { status: 500, detail: "boom" }));

    expect(consoleSpies.error).toHaveBeenCalled();
    expect(consoleSpies.warn).not.toHaveBeenCalled();
  });

  it("logs the backend's error code with a 5xx, so the event carries error_code", () => {
    handleApiError(
      backendError(503, {
        status: 503,
        detail: "down",
        code: "general.unavailable",
      }),
    );

    expect(consoleSpies.error).toHaveBeenCalledWith(
      "api route error",
      expect.objectContaining({
        status: 503,
        error_code: "general.unavailable",
      }),
    );
  });

  it("logs warning for 4xx status codes", () => {
    handleApiError(backendError(400, { status: 400, detail: "Bad Request" }));

    expect(consoleSpies.warn).toHaveBeenCalled();
    expect(consoleSpies.error).not.toHaveBeenCalled();
  });

  it("redacts free-text notes from 409 conflict bodies before logging", () => {
    const response = handleApiError(
      backendError(409, {
        status: 409,
        detail: "existing student status days were not overwritten",
        conflicts: [
          {
            id: 7,
            student_id: 42,
            date: "2026-05-26",
            status: "sick",
            note: "Fieber und Halsschmerzen",
          },
        ],
      }),
    );

    expect(response.status).toBe(409);
    expect(consoleSpies.warn).toHaveBeenCalledWith("api route error", {
      status: 409,
      error: expect.stringContaining('"note":"[REDACTED]"'),
    });
    expect(consoleSpies.warn.mock.calls[0]?.[1]?.error).not.toContain(
      "Fieber und Halsschmerzen",
    );
  });

  it("logs rate-limit responses with rate_limited context", () => {
    handleApiError(new ServerApiResponseError(429, "Rate limit exceeded"));

    expect(consoleSpies.warn).toHaveBeenCalledWith("api route rate limited", {
      status: 429,
      error: "Rate limit exceeded",
      rate_limited: true,
    });
    expect(consoleSpies.error).not.toHaveBeenCalled();
  });

  it("returns 500 for an error without a status", async () => {
    const response = handleApiError(new Error("Something went wrong"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "general.server",
    });
  });

  it("handles non-Error objects", async () => {
    const response = handleApiError("string error");

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "general.server",
    });
  });

  // Regression for Issue #1368: the proxy must forward the backend's
  // structured `details` payload. Dropping details breaks the
  // reopen-with-status-change modal because the UI can no longer learn which
  // session is conflicting from the response.
  it("forwards backend details payload (e.g. reopen_status_conflict)", async () => {
    const response = handleApiError(
      backendError(409, {
        status: 409,
        detail: "reopen status conflict",
        details: {
          session_id: "42",
          existing_status: "present",
          requested_status: "home_office",
        },
      }),
    );
    const body = (await response.json()) as {
      details?: Record<string, unknown>;
    };

    expect(response.status).toBe(409);
    expect(body.details).toEqual({
      session_id: "42",
      existing_status: "present",
      requested_status: "home_office",
    });
  });

  // The companion-plan 409 of the student PUT carries its confirmable
  // conflicts as a TOP-LEVEL `conflicts` array, not under `details`. The
  // browser's CompanionPlanConflictError parses exactly that field to build
  // the confirmation it re-sends — dropping it here leaves the confirmation
  // empty and "Ergänzen und speichern" loops on the same 409 forever.
  it("forwards the top-level conflicts array of a companion-plan 409", async () => {
    const response = handleApiError(
      backendError(409, {
        status: 409,
        detail: "companion departure plan does not allow these days",
        code: "students.companion_plan_conflict",
        conflicts: [{ student_id: 42, weekdays: ["mon", "tue"] }],
      }),
    );
    const body = (await response.json()) as {
      code?: string;
      conflicts?: unknown[];
    };

    expect(response.status).toBe(409);
    expect(body.code).toBe("students.companion_plan_conflict");
    expect(body.conflicts).toEqual([
      { student_id: 42, weekdays: ["mon", "tue"] },
    ]);
  });
});

describe("handleDomainApiError", () => {
  function captureThrown(fn: () => void): unknown {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error("Function did not throw");
  }

  it("passes a structured ApiError through unchanged", () => {
    const error = new ApiError("denied", 403, {
      code: "general.permission",
    });

    expect(
      captureThrown(() => handleDomainApiError(error, "fetch students")),
    ).toBe(error);
  });

  it("keeps status and envelope of a failure that carries a response", () => {
    const error = Object.assign(new Error("Request failed"), {
      response: {
        status: 409,
        data: { detail: "conflict", code: "students.partial_absence_conflict" },
      },
    });

    const thrown = captureThrown(() =>
      handleDomainApiError(error, "fetch students"),
    );

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      status: 409,
      code: "students.partial_absence_conflict",
      message: "Failed to fetch students",
      detail: "conflict",
    });
  });

  it("never reads a status out of the message", () => {
    const thrown = captureThrown(() =>
      handleDomainApiError(
        new Error("API error (403): Access denied"),
        "update activity",
      ),
    );

    expect(thrown).toMatchObject({ status: 500, code: "general.server" });
    expect((thrown as Error).message).toContain("Failed to update activity");
  });

  it("handles non-Error objects", () => {
    const thrown = captureThrown(() =>
      handleDomainApiError("string error", "delete room"),
    );

    expect(thrown).toMatchObject({ status: 500 });
    expect((thrown as Error).message).toContain("Unknown error");
  });
});

// Type for mocked fetch function
type MockedFetch = ReturnType<typeof vi.fn<typeof fetch>>;

// ===== API FUNCTION TESTS (SERVER-SIDE) =====

describe("apiGet (server-side)", () => {
  let originalWindow: typeof globalThis.window;
  let originalFetch: typeof fetch;
  let mockFetch: MockedFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordBackendProxyMetric.mockClear();
    originalWindow = globalThis.window;
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it.each([
    ["GET", "/api/items", undefined],
    ["POST", "/api/items", { name: "conflicting item" }],
  ] as const)(
    "forwards a %s conflict body and status unchanged through the proxy",
    async (method, endpoint, requestBody) => {
      const backendBody = JSON.stringify({
        type: "https://moto-app.de/help/fehlermeldungen#anleitung-vorgang-nicht-moeglich",
        title: "Conflict",
        status: 409,
        detail: "item already exists",
        code: "general.business_rejection",
        details: { item_id: "42" },
        errors: [{ field: "name", reason: "duplicate" }],
        instance: "/api/items/42",
      });
      mockNextHeaders.mockResolvedValueOnce(new Headers());
      mockFetch.mockResolvedValueOnce(
        new Response(backendBody, {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        }),
      );

      let thrown: unknown;
      try {
        if (method === "GET") await apiGet(endpoint, "token");
        else await apiPost(endpoint, "token", requestBody);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ServerApiResponseError);
      const response = handleApiError(thrown);
      expect(response.status).toBe(409);
      expect(response.headers.get("Content-Type")).toBe(
        "application/problem+json",
      );
      expect(await response.text()).toBe(backendBody);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://backend.test${endpoint}`,
        expect.objectContaining({ method }),
      );
    },
  );

  // Backend and BFF events of one request share the Vorgangskennung (#3641).
  it("forwards the proxy's Vorgangskennung to the backend", async () => {
    mockNextHeaders.mockResolvedValueOnce(
      new Headers({ "x-request-id": "0b6f3f4e-5c1d-4a52-9d57-2d3c1b5e8f10" }),
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);

    await apiGet<{ result: string }>("/api/groups", "token");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend.test/api/groups",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Request-ID": "0b6f3f4e-5c1d-4a52-9d57-2d3c1b5e8f10",
        }) as HeadersInit,
      }),
    );
  });

  it("forwards an abort signal to the backend", async () => {
    const controller = new AbortController();
    mockNextHeaders.mockResolvedValueOnce(new Headers());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);

    await apiGet<{ result: string }>("/api/test", "token", {
      signal: controller.signal,
    });
    const sent = mockFetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(sent.aborted).toBe(false);

    controller.abort();

    expect(sent.aborted).toBe(true);
  });

  it("omits forward headers when no client IP or user agent is available", async () => {
    mockNextHeaders.mockResolvedValueOnce(new Headers());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);

    await apiGet<{ result: string }>("/api/test", "token");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend.test/api/test",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token",
        },
      }),
    );
  });

  it("records tenant backend proxy metrics for server-side calls", async () => {
    mockNextHeaders.mockResolvedValueOnce(new Headers());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "17" }),
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);
    const tokenPayload = Buffer.from(
      JSON.stringify({ tenant_id: 101, scope: "" }),
    ).toString("base64url");

    await apiGet<{ result: string }>(
      "/api/students/1234567890123456?verbose=true",
      `header.${tokenPayload}.signature`,
    );

    expect(mockRecordBackendProxyMetric).toHaveBeenCalledWith({
      method: "GET",
      backendEndpoint: "/api/students/{id}",
      status: 200,
      durationMs: expect.any(Number),
      outcome: "success",
      scope: "",
    });
  });

  it("still calls the backend when request headers are unavailable", async () => {
    mockNextHeaders.mockRejectedValueOnce(new Error("outside request scope"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: "ok" }),
    } as Response);

    await apiGet<{ result: string }>("/api/test", "token");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend.test/api/test",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token",
        },
      }),
    );
  });
});
