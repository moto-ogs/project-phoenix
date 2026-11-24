import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { RouteContext } from "~/lib/route-wrapper-utils.server";

const { mockAuth, mockFetch, mockGetServerApiUrl, mockRevalidatePath } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFetch: vi.fn(),
    mockGetServerApiUrl: vi.fn(() => "http://localhost:8080"),
    mockRevalidatePath: vi.fn(),
  }));

vi.mock("~/server/auth/operator", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("operator", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: mockGetServerApiUrl,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

global.fetch = mockFetch as unknown as typeof fetch;

import { PUT, DELETE } from "./route";

function schoolSummary(id: string, subdomain: string) {
  return {
    id,
    slug: `slug-${subdomain}`,
    subdomain,
    name: subdomain,
    organization_id: "1",
    organization_name: "Test Träger",
    active: true,
    hidden: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    konten_count: 0,
    geraete_count: 0,
    personen_count: 0,
    child_quota_bundles: null,
    child_quota_bundle_size: 20,
    child_quota_count: 0,
    device_slots: null,
    version: "v-1",
  };
}

describe("PUT /api/operator/schools/[id]/settings/values/[key]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("proxies valid setting update to backend", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: {} }),
    });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/operations.session_end_time",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "18:30" }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: "10",
        key: "operations.session_end_time",
      }),
    };
    const response = await PUT(request, context);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/operator/schools/10/settings/values/operations.session_end_time",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("purges the tenant cache even when the committed write's answer is unreadable", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch
      .mockResolvedValueOnce(new Response("not JSON", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: [schoolSummary("10", "school-ten")],
        }),
      );
    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/analytics.enabled",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: false }),
      },
    );

    const result = await PUT(request, {
      params: Promise.resolve({ id: "10", key: "analytics.enabled" }),
    });

    expect(result.status).toBe(502);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/school-ten", "layout");
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x" }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "foo.bar" }),
    };
    const response = await PUT(request, context);

    expect(response.status).toBe(401);
  });

  it("rejects invalid key pattern (uppercase not allowed)", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/BAD.KEY",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x" }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "BAD.KEY" }),
    };
    const response = await PUT(request, context);

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-string id parameter", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x" }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: 10 as unknown as string,
        key: "foo.bar",
      }),
    };
    const response = await PUT(request, context);

    // An invalid route param is the request's mistake: a coded 400.
    expect(response.status).toBe(400);
  });

  it.each([
    { key: "operations.student_photos_enabled", schoolId: "10" },
    { key: "analytics.enabled", schoolId: "10" },
    { key: "analytics.enabled", schoolId: "9007199254740993" },
  ])(
    "revalidates tenant cache after writing $key for school $schoolId",
    async ({ key, schoolId }) => {
      mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
      // First fetch: the backend PUT. Second fetch: the slug lookup via
      // /operator/schools/summaries that revalidateTenantIfNeeded issues.
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "success", data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            data: [
              schoolSummary(schoolId, "school-ten"),
              schoolSummary("11", "school-eleven"),
            ],
          }),
        });

      const request = new NextRequest(
        `http://localhost:3000/api/operator/schools/${schoolId}/settings/values/${key}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: false }),
        },
      );
      const context: RouteContext = {
        params: Promise.resolve({
          id: schoolId,
          key,
        }),
      };
      const response = await PUT(request, context);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:8080/operator/schools/${schoolId}/settings/values/${key}`,
        expect.objectContaining({ method: "PUT" }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/operator/schools/summaries",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/school-ten", "layout");
    },
  );

  it("revalidates tenant metadata after an operator changes grade_level_max", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: [schoolSummary("10", "school-ten")],
        }),
      });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/enrollment.grade_level_max",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 13 }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: "10",
        key: "enrollment.grade_level_max",
      }),
    };

    const response = await PUT(request, context);

    expect(response.status).toBe(200);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/school-ten", "layout");
  });

  it("skips revalidation when the key does not affect /auth/tenant/resolve", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: {} }),
    });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/operations.session_end_time",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "18:30" }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: "10",
        key: "operations.session_end_time",
      }),
    };
    await PUT(request, context);

    // Only the backend PUT, never the summaries lookup.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("skips revalidation when the slug lookup cannot resolve the school", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: {} }),
      })
      // summaries lookup returns an empty list — no matching id.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: [] }),
      });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/operations.student_photos_enabled",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: false }),
      },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: "10",
        key: "operations.student_photos_enabled",
      }),
    };
    const response = await PUT(request, context);

    expect(response.status).toBe(200);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/operator/schools/[id]/settings/values/[key]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("proxies reset to backend", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: {} }),
    });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      { method: "DELETE" },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "foo.bar" }),
    };
    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/operator/schools/10/settings/values/foo.bar",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      { method: "DELETE" },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "foo.bar" }),
    };
    const response = await DELETE(request, context);

    expect(response.status).toBe(401);
  });

  it("rejects invalid key pattern", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/bad key",
      { method: "DELETE" },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "bad key" }),
    };
    const response = await DELETE(request, context);

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-string id parameter", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      { method: "DELETE" },
    );
    const context: RouteContext = {
      params: Promise.resolve({
        id: 10 as unknown as string,
        key: "foo.bar",
      }),
    };
    const response = await DELETE(request, context);

    // An invalid route param is the request's mistake: a coded 400.
    expect(response.status).toBe(400);
  });

  it.each([
    { key: "operations.student_photos_enabled", schoolId: "10" },
    { key: "analytics.enabled", schoolId: "10" },
    { key: "analytics.enabled", schoolId: "9007199254740993" },
  ])(
    "revalidates tenant cache after writing $key for school $schoolId",
    async ({ key, schoolId }) => {
      mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
      mockFetch
        // Backend DELETE — 204 No Content, parseResponse short-circuits.
        .mockResolvedValueOnce(Response.json({ status: "success", data: {} }))
        // Slug lookup.
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            data: [schoolSummary(schoolId, "school-ten")],
          }),
        });

      const request = new NextRequest(
        `http://localhost:3000/api/operator/schools/${schoolId}/settings/values/${key}`,
        { method: "DELETE" },
      );
      const context: RouteContext = {
        params: Promise.resolve({
          id: schoolId,
          key,
        }),
      };
      const response = await DELETE(request, context);

      expect(response.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/school-ten", "layout");
    },
  );

  it("skips revalidation when the key does not affect /auth/tenant/resolve", async () => {
    mockAuth.mockResolvedValue({ user: { token: "valid-token" } });
    mockFetch.mockResolvedValue(Response.json({ status: "success", data: {} }));

    const request = new NextRequest(
      "http://localhost:3000/api/operator/schools/10/settings/values/foo.bar",
      { method: "DELETE" },
    );
    const context: RouteContext = {
      params: Promise.resolve({ id: "10", key: "foo.bar" }),
    };
    await DELETE(request, context);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
