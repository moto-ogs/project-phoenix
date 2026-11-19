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
 * The links of an invitation mail and of the holiday registration, and the
 * school list, below the staff portal's `/api/auth` (#2352): Next would give
 * these paths to Auth.js, so a hand-off file gives them to the staff portal's
 * catalog proxy. Each runs without a session and sends no bearer, even when
 * someone is signed in on the device; the staff portal's session routes on
 * the same path keep the session.
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
  tail: string[],
  body?: unknown,
) {
  return (handler as Handler)(
    new NextRequest("http://localhost/x", {
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
    method: init?.method,
    authorization: new Headers(init?.headers).get("Authorization"),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
};

const answer = (data: unknown, status = 200) =>
  backend.mockImplementation(async () =>
    Response.json({ status: "success", message: "done", data }, { status }),
  );

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
});

describe("public links below the staff portal's auth", () => {
  it("accepts a guardian invitation without a bearer", async () => {
    const { POST } =
      await import("./auth/guardian-invitations/[...path]/route");
    answer({ account_id: "42", email: "a@example.test" }, 201);
    const body = { password: "pw-1", confirm_password: "pw-1" };

    const response = await call(POST, "POST", ["tok", "accept"], body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Success",
      data: { account_id: "42", email: "a@example.test" },
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(sent()).toEqual({
      path: "/auth/guardian-invitations/tok/accept",
      method: "POST",
      authorization: null,
      body,
    });
  });

  it("reads and completes the holiday parent setup without a bearer", async () => {
    const { GET, POST } =
      await import("./auth/holiday-parent-setups/[...path]/route");
    answer({
      email: "a@example.test",
      traeger_name: "T",
      account_exists: true,
    });

    const read = await call(GET, "GET", ["tok"]);

    expect(read.status).toBe(200);
    expect((await read.json()).data).toEqual({
      email: "a@example.test",
      traeger_name: "T",
      account_exists: true,
    });
    expect(sent()).toMatchObject({
      path: "/auth/holiday-parent-setups/tok",
      method: "GET",
      authorization: null,
    });

    backend.mockReset();
    answer({ account_exists: false });
    const done = await call(POST, "POST", ["tok"], {});

    expect((await done.json()).data).toEqual({ account_exists: false });
    expect(sent()).toMatchObject({
      path: "/auth/holiday-parent-setups/tok",
      method: "POST",
      authorization: null,
    });
  });

  it("passes the backend's refusal of a link through with its code", async () => {
    const { GET } =
      await import("./auth/holiday-parent-setups/[...path]/route");
    backend.mockImplementation(async () =>
      Response.json(
        {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "invalid link",
          code: "identity.holiday_parent_setup_invalid",
        },
        {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );

    const response = await call(GET, "GET", ["tok"]);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "identity.holiday_parent_setup_invalid",
    });
  });

  it("lists the schools without a bearer", async () => {
    const { GET } = await import("./auth/tenants/route");
    answer([{ slug: "a", name: "A", subdomain: "a", organization_name: "T" }]);

    const response = await call(GET, "GET", []);

    expect((await response.json()).data).toEqual([
      { slug: "a", name: "A", subdomain: "a", organization_name: "T" },
    ]);
    expect(sent()).toMatchObject({
      path: "/auth/tenants",
      authorization: null,
    });
  });

  it("validates a staff invitation link without a bearer", async () => {
    const { GET } = await import("./auth/invitations/[[...path]]/route");
    answer({
      target_portal: "tenant",
      requires_account_login: false,
      email: "a@example.test",
      role_name: "Betreuung",
      caregiver_enabled: false,
      expires_at: "2026-12-01T10:00:00Z",
    });

    const response = await call(GET, "GET", ["tok"]);

    expect(response.status).toBe(200);
    expect(sent()).toMatchObject({
      path: "/auth/invitations/tok",
      authorization: null,
    });
  });

  it("keeps the session for the staff portal's invitation routes", async () => {
    const { DELETE } = await import("./auth/invitations/[[...path]]/route");
    backend.mockImplementation(async () => new Response(null, { status: 204 }));

    const response = await call(DELETE, "DELETE", ["5"]);

    expect(response.status).toBe(204);
    expect(sent()).toMatchObject({
      path: "/auth/invitations/5",
      authorization: "Bearer session-token",
    });
  });

  it("answers a path the contract does not register 404 without a call", async () => {
    const { POST } =
      await import("./auth/guardian-invitations/[...path]/route");

    const response = await call(POST, "POST", ["5", "resend"], {});

    expect(response.status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
});
