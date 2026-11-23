import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { ApiError } from "./api-error";
import {
  enrollConfirm,
  listTrustedDevices,
  login,
  resendChallenge,
  revokeTrustedDevice,
  verifyMFA,
} from "./mfa-api";

describe("login error bodies", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockErrorBody(status: number, body: unknown) {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof global.fetch;
  }

  // The backend's `code` is the stable contract; `detail` is English
  // diagnostics that callers must not branch on. Without this the tenant
  // login cannot tell a guardian-only account apart from any other 403.
  it("surfaces the backend code on the thrown ApiError", async () => {
    mockErrorBody(403, {
      status: 403,
      detail: "guardian accounts must log in at the parents portal",
      code: "identity.use_parent_portal",
    });

    const rejection = login("tenant", {
      email: "a@b.de",
      password: "pw",
      tenantSlug: "s",
    });
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({
      status: 403,
      code: "identity.use_parent_portal",
      message: "POST /api/auth/login failed (403)",
      detail: "guardian accounts must log in at the parents portal",
    });
  });

  // The MFA failures used to be told apart by matching "locked", "invalid"
  // or "code request" in the text. They now arrive as codes the catalog
  // translates.
  it.each([
    [401, "identity.mfa_code_invalid", "invalid or expired code"],
    [429, "identity.mfa_blocked", "account locked due to too many attempts"],
  ])("carries the MFA code of a %i answer", async (status, code, detail) => {
    mockErrorBody(status, { status, detail, code });

    await expect(
      login("school", { email: "a@b.de", password: "pw" }),
    ).rejects.toMatchObject({ status, code });
  });

  it("uses the permission class code when the body carries none", async () => {
    mockErrorBody(401, {
      status: 401,
      detail: "invalid username or password",
    });

    await expect(
      login("tenant", { email: "a@b.de", password: "pw", tenantSlug: "s" }),
    ).rejects.toMatchObject({ status: 401, code: "general.permission" });
  });

  it("classifies a failed transport as unavailable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      login("tenant", { email: "a@b.de", password: "pw", tenantSlug: "s" }),
    ).rejects.toMatchObject({ status: 503, code: "general.unavailable" });
  });
});

describe("caterer second factor (#4497)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the caterer MFA and trusted-device routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: { status: "authenticated" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: { challenge_token: "renewed" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "success", data: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(
      verifyMFA("caterer", {
        challengeToken: "c",
        code: "123456",
        rememberDevice: true,
      }),
    ).resolves.toEqual({ status: "authenticated" });
    await expect(
      resendChallenge("caterer", { challengeToken: "c" }),
    ).resolves.toBe("renewed");
    await listTrustedDevices("caterer");
    await revokeTrustedDevice("caterer", "7");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/caterer/auth/mfa/verify",
      "/api/caterer/auth/mfa/resend",
      "/api/caterer/auth/mfa/trusted-devices",
      "/api/caterer/auth/mfa/trusted-devices/7",
    ]);
  });

  it("reads the parents' devices at the backend path in the envelope", async () => {
    const device = {
      id: "3",
      created_at: "2026-09-01T10:00:00Z",
      expires_at: "2026-12-01T10:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: [device] }),
      )
      .mockResolvedValueOnce(Response.json({ status: "success", data: null }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(listTrustedDevices("parent")).resolves.toEqual([device]);
    await expect(listTrustedDevices("parent")).resolves.toEqual([]);
    await revokeTrustedDevice("parent", "3");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/parent/me/mfa/trusted-devices",
      "/api/parent/me/mfa/trusted-devices",
      "/api/parent/me/mfa/trusted-devices/3",
    ]);
  });
});

describe("Träger organization IDs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["verify", "enroll/confirm"] as const)(
    "preserves a bigint ID in %s",
    async (step) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          status: "success",
          data: { status: "authenticated" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const organizationId = "9007199254740993";
      const result =
        step === "verify"
          ? await verifyMFA("traeger", {
              challengeToken: "challenge",
              code: "123456",
              rememberDevice: true,
              organizationId,
            })
          : await enrollConfirm(
              "traeger",
              "enrollment",
              "123456",
              "challenge",
              organizationId,
            );

      expect(result).toEqual({ status: "authenticated" });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`/api/traeger/auth/mfa/${step}`);
      expect(JSON.parse(init.body as string)).toMatchObject({
        organization_id: organizationId,
      });
    },
  );
});

it("all portal MFA results exclude completed session credentials", () => {
  expectTypeOf<Awaited<ReturnType<typeof verifyMFA>>>().toEqualTypeOf<{
    status: "authenticated";
  }>();
  expectTypeOf<Awaited<ReturnType<typeof enrollConfirm>>>().toEqualTypeOf<{
    status: "authenticated";
  }>();
});
