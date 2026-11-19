import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

/**
 * The hand-off files below a portal's `auth` (#2352): Next would give these
 * paths to Auth.js, so each file hands them to the portal's catalog proxy.
 * A public route runs without a session and sends no bearer, also in the
 * portals whose catch-all serves no public route; a path the contract does
 * not register is a 404 before any backend call.
 */

vi.mock("next-auth", () => ({
  default: () => ({
    auth:
      (handler: (request: unknown, context: unknown) => unknown) =>
      (request: Request & { auth?: unknown }, context: unknown) => {
        request.auth = {
          expires: "2099-01-01T00:00:00.000Z",
          user: { id: "1", token: "session-token", refreshToken: "r" },
        };
        return handler(request, context);
      },
    handlers: { GET: vi.fn(), POST: vi.fn() },
    signIn: vi.fn(),
    unstable_update: vi.fn(),
  }),
}));

const backend = vi.fn<typeof fetch>();
type Handler = (request: NextRequest, context: unknown) => Promise<Response>;

function call(
  handler: unknown,
  method: string,
  url: string,
  tail: string[],
  body?: unknown,
) {
  return (handler as Handler)(
    new NextRequest(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve(tail.length > 0 ? { path: tail } : {}) },
  );
}

const sent = () => {
  const [url, init] = backend.mock.calls[0] ?? [];
  return {
    path: new URL(String(url)).pathname,
    authorization: new Headers(init?.headers).get("Authorization"),
  };
};

beforeAll(() => {
  vi.stubGlobal("fetch", backend);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  backend.mockReset();
  backend.mockImplementation(async () =>
    Response.json({ status: "success", message: "sent" }),
  );
});

describe("public routes below a portal's auth", () => {
  it.each([
    [
      "school",
      () => import("./school/auth/password-reset/[[...path]]/route"),
      [],
      "/school/auth/password-reset",
    ],
    [
      "parent",
      () => import("./parent/auth/password-reset/[[...path]]/route"),
      ["confirm"],
      "/parent/auth/password-reset/confirm",
    ],
    [
      "tenant",
      () => import("./auth/password-reset/[[...path]]/route"),
      [],
      "/auth/password-reset",
    ],
    [
      "operator",
      () => import("./operator/auth/email-confirm/[[...path]]/route"),
      [],
      "/operator/auth/email-confirm",
    ],
  ] as const)(
    "%s reaches %s without a bearer",
    async (_portal, load, tail, path) => {
      const { POST } = await load();
      const response = await call(
        POST,
        "POST",
        "http://localhost/x",
        [...tail],
        {
          email: "a@example.test",
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        message: "Success",
        data: null,
      });
      expect(sent()).toEqual({ path, authorization: null });
    },
  );
});

describe("session routes below a portal's auth", () => {
  it("sends the session bearer for a registered route", async () => {
    const { DELETE } = await import("./school/auth/mfa/[...path]/route");
    backend.mockImplementation(async () => new Response(null, { status: 204 }));

    const response = await call(DELETE, "DELETE", "http://localhost/x", [
      "trusted-devices",
      "4",
    ]);

    expect(response.status).toBe(204);
    expect(sent()).toEqual({
      path: "/school/auth/mfa/trusted-devices/4",
      authorization: "Bearer session-token",
    });
  });

  it("answers a path the contract does not register 404 without a call", async () => {
    const { POST } = await import("./traeger/auth/mfa/[...path]/route");

    const response = await call(POST, "POST", "http://localhost/x", ["verify"]);

    expect(response.status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
});
