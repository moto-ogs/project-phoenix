import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Files and uploads whose route files left for the portals' catalog proxies
 * (#2352). The behavior their route files' tests asserted still holds there.
 */

const { mockAuth, mockUncachedAuth, mockOperatorAuth, mockOperatorUncached } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockUncachedAuth: vi.fn(),
    mockOperatorAuth: vi.fn(),
    mockOperatorUncached: vi.fn(),
  }));
const mockFetch = vi.fn();

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
    uncachedAuth: mockUncachedAuth,
  }),
);
vi.mock("~/server/auth/operator", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("operator", {
    auth: mockOperatorAuth,
    uncachedAuth: mockOperatorUncached,
  }),
);
vi.mock("~/server/auth/parent", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("parent", {
    auth: mockAuth,
    uncachedAuth: mockUncachedAuth,
  }),
);
vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://backend:8080",
}));
vi.mock("~/lib/sentry-bff.server", () => ({
  captureBffException: vi.fn(),
}));

const tenant = await import("./[...path]/route");
const operator = await import("./operator/[...path]/route");
const parent = await import("./parent/[...path]/route");

const context = (path: string[]) => ({
  params: Promise.resolve({ path }) as Promise<never>,
});

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  mockAuth.mockReset().mockResolvedValue({ user: { token: "old-token" } });
  mockUncachedAuth
    .mockReset()
    .mockResolvedValue({ user: { token: "new-token" } });
  mockOperatorAuth
    .mockReset()
    .mockResolvedValue({ user: { token: "operator-token" } });
  mockOperatorUncached.mockReset();
});

// The school's download of a Träger document (#4692) is rate-limited and
// audited per visitor, so both attempts carry the client's identity.
describe("GET /api/traeger-documents/[id]/file", () => {
  it("forwards the client identity on the first try and after a refresh", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response("%PDF", {
          headers: { "content-type": "application/pdf" },
        }),
      );
    const response = await tenant.GET(
      new NextRequest("http://localhost:3000/api/traeger-documents/7/file", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "user-agent": "Elternbrief-Test",
        },
      }),
      context(["traeger-documents", "7", "file"]),
    );

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [index, token] of [
      [1, "old-token"],
      [2, "new-token"],
    ] as const) {
      expect(mockFetch).toHaveBeenNthCalledWith(
        index,
        "http://backend:8080/api/traeger-documents/7/file",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
            "X-Forwarded-For": "203.0.113.9",
            "User-Agent": "Elternbrief-Test",
          }),
        }),
      );
    }
  });
});

describe("GET /api/operator/billing/key-date-counts/export", () => {
  const call = () =>
    operator.GET(
      new NextRequest(
        "http://localhost:3000/api/operator/billing/key-date-counts/export?month=2026-10",
      ),
      context(["billing", "key-date-counts", "export"]),
    );

  it("asks for the month and returns unavailable when the backend cannot be reached", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const response = await call();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend:8080/operator/billing/key-date-counts/export?month=2026-10",
      expect.anything(),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: 503,
      code: "general.unavailable",
    });
  });

  it("answers 503 when renewing the session could not be decided", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
    mockOperatorUncached.mockRejectedValue(
      new Error("session service unavailable"),
    );

    const response = await call();

    // A renewal that throws (session service down) is undecided: 503, and
    // the session stays as it is.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "general.unavailable",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * A chat attachment over 10 MB and its multipart frame never reaches the
 * backend; the client shows the catalog text of `files.file_too_large` with
 * the limit (#6685).
 */
describe("message attachment upload over the limit", () => {
  const oversized = (url: string) =>
    new NextRequest(url, {
      method: "POST",
      body: "x",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(11 * 1024 * 1024),
      },
    });

  it.each([
    [
      "staff → parents",
      () =>
        tenant.POST(
          oversized("http://localhost:3000/api/messages/attachments"),
          context(["messages", "attachments"]),
        ),
    ],
    [
      "team chat",
      () =>
        tenant.POST(
          oversized("http://localhost:3000/api/staff-messages/attachments"),
          context(["staff-messages", "attachments"]),
        ),
    ],
    [
      "parents",
      () =>
        parent.POST(
          oversized(
            "http://localhost:3000/api/parent/me/messages/children/5/attachments",
          ),
          context(["me", "messages", "children", "5", "attachments"]),
        ),
    ],
  ])("%s: 413 with the code and the limit", async (_name, call) => {
    const response = await call();

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "files.file_too_large",
      details: { max_mb: 10 },
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// The export's filter body stays bounded like the former route file's (1 MiB).
describe("POST /api/students/export", () => {
  it("refuses a body over 1 MiB before the backend", async () => {
    const { POST } = await import("./students/export/route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/students/export", {
        method: "POST",
        body: JSON.stringify({ title: "x".repeat(1024 * 1024) }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(413);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
