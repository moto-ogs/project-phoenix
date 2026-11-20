import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockFetch, mockAuth } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockAuth: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/server/auth/parent", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("parent", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/server/auth/traeger", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("traeger", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/server/auth/school", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("school", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/server/auth/caterer", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("caterer", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/server/auth/operator", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("operator", {
    auth: mockAuth,
    uncachedAuth: mockAuth,
  }),
);
vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://localhost:8080",
}));

// Each route reads its own params; `never` takes every handler's context.
type Route = (
  request: NextRequest,
  context: { params: Promise<never> },
) => Promise<Response>;

const downloadParams = {
  id: "1",
  documentId: "2",
  organizationId: "3",
  announcementId: "4",
  token: "status-token",
};

const routes: Array<
  [string, string, () => Promise<Route>, Record<string, unknown>?]
> = [
  [
    "student export",
    "POST",
    async () => (await import("./students/export/route")).POST,
    {},
  ],
  [
    "staff streaming export",
    "GET",
    async () => (await import("./[...path]/route")).GET,
    { path: ["staff", "time-tracking", "export"] },
  ],
  [
    "student document",
    "GET",
    async () => (await import("./[...path]/route")).GET,
    { path: ["students", "1", "documents", "2", "download"] },
  ],
  [
    "parent document",
    "GET",
    async () =>
      (
        await import("./parent/me/documents/[organizationId]/[documentId]/pdf/route")
      ).GET,
  ],
  [
    "school declaration",
    "GET",
    async () =>
      (
        await import("./school/parent-letters/[announcementId]/declaration-export/route")
      ).GET,
  ],
  [
    "operator export",
    "GET",
    async () => (await import("./operator/[...path]/route")).GET,
    { path: ["billing", "key-date-counts", "export"] },
  ],
  // A file the contract registers runs through the portal's catalog proxy.
  [
    "Träger export",
    "GET",
    async () => (await import("./traeger/[...path]/route")).GET,
    { path: ["access-log", "export"] },
  ],
  [
    "staff export",
    "GET",
    async () => (await import("./[...path]/route")).GET,
    { path: ["students", "day-log", "export"] },
  ],
  // A public file the contract marks runs through the catalog proxy's
  // session-free path (#2352).
  [
    "planning export",
    "POST",
    async () => (await import("./[...path]/route")).POST,
    { path: ["rooms", "export"] },
  ],
  [
    "caterer export",
    "GET",
    async () => (await import("./caterer/[...path]/route")).GET,
    { path: ["orders", "export"] },
  ],
  [
    "token-bound proof",
    "GET",
    async () => (await import("./[...path]/route")).GET,
    { path: ["enrollment", "requests", "status-token", "signature-proof"] },
  ],
  [
    "payroll link",
    "POST",
    async () => (await import("./[...path]/route")).POST,
    { path: ["public", "payroll-download", "1.status-token"] },
  ],
  [
    "holiday form document",
    "GET",
    async () => (await import("./traeger/[...path]/route")).GET,
    { path: ["holiday-registrations", "period-link", "documents", "2"] },
  ],
  [
    "care contract document",
    "GET",
    async () => (await import("./[...path]/route")).GET,
    { path: ["public", "care-contract-signing", "42.link", "document"] },
  ],
];

function call(
  route: Route,
  method: string,
  params: Record<string, unknown> = downloadParams,
) {
  return route(
    new NextRequest("http://localhost:3000/api/export?format=pdf", {
      method,
      ...(method === "POST" ? { body: "{}" } : {}),
    }),
    { params: Promise.resolve(params) as Promise<never> },
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  mockAuth.mockReset().mockResolvedValue({ user: { token: "access-token" } });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("private file responses (#5119)", () => {
  it.each(routes)(
    "%s: protects real file bytes and download headers",
    async (_name, method, load, params) => {
      const bytes = new Uint8Array([0, 255, 37, 80, 68, 70]);
      mockFetch.mockResolvedValue(
        new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="report.pdf"',
            "Content-Length": String(bytes.length),
            // Even a mistaken upstream cache policy cannot expose private files.
            "Cache-Control": "public, max-age=3600",
          },
        }),
      );

      const response = await call(await load(), method, params);

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="report.pdf"',
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it.each([
    "text/csv; charset=utf-8",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ])("protects %s as well as PDF", async (contentType) => {
    const bytes = new Uint8Array([0, 255, 1, 2]);
    mockFetch.mockResolvedValue(
      new Response(bytes, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(bytes.length),
        },
      }),
    );
    const { POST } = await import("./students/export/route");
    const response = await call(POST, "POST", {});
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each(routes)(
    "%s: protects backend errors",
    async (_name, method, load, params) => {
      for (const status of [401, 403, 503]) {
        // A 401 renews the session first; a refused renewal keeps it a 401.
        if (status === 401) {
          mockAuth
            .mockResolvedValueOnce({ user: { token: "access-token" } })
            .mockResolvedValueOnce({
              user: { token: "" },
              error: "RefreshTokenError",
            });
        }
        mockFetch.mockImplementation(() =>
          Promise.resolve(
            new Response("denied", {
              status,
              headers: { "Content-Type": "text/plain" },
            }),
          ),
        );
        const response = await call(await load(), method, params);
        expect(response.status).toBe(status);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    },
  );

  it("returns a streaming download before the upstream finishes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    mockFetch.mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/pdf", "Content-Length": "4" },
      }),
    );
    const { GET } = await import("./[...path]/route");
    const response = await call(GET, "GET", {
      path: ["staff", "time-tracking", "export"],
    });
    expect(response.status).toBe(200);
    // Taken over at once (forwardedBody), so a collected upstream Response
    // cannot cancel it; the reads below prove it still streams unbuffered.
    expect(stream.locked).toBe(true);
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const reader = response.body!.getReader();
    controller.enqueue(new Uint8Array([1, 2]));
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([1, 2]),
    });
    controller.enqueue(new Uint8Array([3, 4]));
    controller.close();
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([3, 4]),
    });
    expect((await reader.read()).done).toBe(true);
  });
});

// The four token links of #2352, on the real catch-all routes and the
// generated contract: a signed-in device sends neither its bearer nor its
// cookies, and a link the contract does not mark as a public file stays 404.
describe("public file routes (#2352)", () => {
  const links: Array<[string, string, () => Promise<Route>, string[], string]> =
    [
      [
        "enrollment proof",
        "GET",
        async () => (await import("./[...path]/route")).GET,
        ["enrollment", "requests", "status-token", "signature-proof"],
        "http://localhost:8080/api/enrollment/requests/status-token/signature-proof",
      ],
      [
        "payroll link",
        "POST",
        async () => (await import("./[...path]/route")).POST,
        ["public", "payroll-download", "1.link-token"],
        "http://localhost:8080/public/payroll-download/1.link-token",
      ],
      [
        "care contract document",
        "GET",
        async () => (await import("./[...path]/route")).GET,
        ["public", "care-contract-signing", "42.link", "document"],
        "http://localhost:8080/public/care-contract-signing/42.link/document",
      ],
      [
        "holiday form document",
        "GET",
        async () => (await import("./traeger/[...path]/route")).GET,
        ["holiday-registrations", "period-link", "documents", "2"],
        "http://localhost:8080/traeger/holiday-registrations/period-link/documents/2",
      ],
    ];

  it.each(links)(
    "%s: reaches the backend without the device's session",
    async (_name, method, load, path, backendUrl) => {
      mockFetch.mockResolvedValue(
        new Response(new Uint8Array([1]), {
          headers: { "Content-Type": "application/pdf" },
        }),
      );
      const route = await load();
      const response = await route(
        new NextRequest("http://localhost:3000/api/x?format=pdf", {
          method,
          headers: {
            Cookie: "authjs.session-token=staff-session",
            Authorization: "Bearer forged",
            "X-Forwarded-For": "203.0.113.7",
          },
        }),
        { params: Promise.resolve({ path }) as Promise<never> },
      );
      expect(response.status).toBe(200);
      expect(mockAuth).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(backendUrl);
      const sent = Object.keys(init.headers ?? {}).map((name) =>
        name.toLowerCase(),
      );
      expect(sent).not.toContain("authorization");
      expect(sent).not.toContain("cookie");
      expect((init.headers as Record<string, string>)["X-Forwarded-For"]).toBe(
        "203.0.113.7",
      );
      expect(init.body).toBeUndefined();
    },
  );

  it("answers the old holiday document path 404, as a route nobody serves", async () => {
    const { GET } = await import("./[...path]/route");
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/holiday-registrations/period-link/documents/2",
      ),
      {
        params: Promise.resolve({
          path: ["holiday-registrations", "period-link", "documents", "2"],
        }) as Promise<never>,
      },
    );
    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
