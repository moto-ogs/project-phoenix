import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as status } from "./status/route";
import { POST as sessions } from "./sessions/route";
import { stubPortalHostEnv } from "~/test/route-test-helpers";

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://server:8080",
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    setSession: vi.fn(),
    withSessionResponse: (handler: unknown) => handler,
  }),
);
vi.mock("~/server/auth/parent", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("parent", {
    setSession: vi.fn(),
    withSessionResponse: (handler: unknown) => handler,
  }),
);
const fetchMock = vi.fn();

function request(body: unknown) {
  return new NextRequest("http://messe-demo.localhost:3000/api/demo/access/x", {
    method: "POST",
    headers: { Origin: "http://messe-demo.localhost:3000" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  stubPortalHostEnv();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("demo access routes", () => {
  it("asks the backend for the status with the token in a header, not the URL", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "ready", school_name: "OGS Demo" }),
    );

    const response = await status(request({ token: "secret-token" }));

    expect(await response.json()).toEqual({
      status: "success",
      data: { status: "ready", school_name: "OGS Demo" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://server:8080/demo/access/status");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
  });

  it("redeems by POST and passes the backend status through", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: "identity.demo_access_expired" }, { status: 410 }),
    );

    const response = await sessions(request({ token: "secret-token" }));

    expect(response.status).toBe(410);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://server:8080/demo/access/sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ token: "secret-token" }));
  });

  // The banner switches the demo role later (#3467). The token stays in a
  // cookie no script can read, sent to the demo routes only.
  it("keeps a redeemed token in an httpOnly cookie for later role switches", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        demo: {
          access_id: "4711",
          role: "lead",
          fixed_role: false,
          traeger: true,
        },
      }),
    );

    const response = await sessions(
      request({ token: "secret-token", role: "lead" }),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ token: "secret-token", role: "lead" }),
    );
    const cookie = new NextResponse(null, {
      headers: response.headers,
    }).cookies.get("moto-demo-token");
    expect(cookie).toMatchObject({
      value: "secret-token",
      httpOnly: true,
      sameSite: "strict",
      path: "/api/demo",
      maxAge: 14 * 24 * 60 * 60,
    });
    // The banner learns whether the school's own Träger-Büro is open (#6193).
    expect(await response.json()).toEqual({
      status: "success",
      data: {
        session_created: true,
        demo: {
          access_id: "4711",
          role: "lead",
          fixed_role: false,
          traeger: true,
        },
      },
    });
    // Tokens and access IDs must not stay in a shared device's cache (#4999).
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("switches the role with the token from the cookie", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        demo: {
          access_id: "4711",
          role: "caregiver",
          fixed_role: false,
          traeger: false,
        },
      }),
    );
    const switchRequest = request({ role: "caregiver" });
    switchRequest.cookies.set("moto-demo-token", "secret-token");

    const response = await sessions(switchRequest);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ token: "secret-token", role: "caregiver" }),
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("revokes a minted session when the banner payload cannot be decoded", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: "minted-access",
          refresh_token: "minted-refresh",
          demo: { access_id: "4711", role: "parent", traeger: false },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await sessions(request({ token: "secret-token" }));

    expect(response.status).toBe(502);
    expect(response.headers.getSetCookie()).toEqual([]);
    const error = await response.text();
    expect(error).toContain("general.write_answer_unreadable");
    expect(error).not.toContain("minted-");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://server:8080/auth/logout");
    expect(fetchMock.mock.calls[1]?.[1]?.headers.Authorization).toBe(
      "Bearer minted-refresh",
    );
  });

  it("sets no cookie when the backend refuses the token", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: "identity.demo_access_unknown" }, { status: 404 }),
    );

    const response = await sessions(request({ token: "wrong-token" }));

    expect(response.status).toBe(404);
    expect(
      new NextResponse(null, { headers: response.headers }).cookies.get(
        "moto-demo-token",
      ),
    ).toBeUndefined();
  });

  it("answers 404 without a token and never calls the backend", async () => {
    const response = await sessions(request({}));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
