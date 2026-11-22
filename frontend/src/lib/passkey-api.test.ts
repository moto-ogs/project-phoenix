import { ApiError } from "./api-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHandleAuthFailure,
  mockBrowserSupportsWebAuthn,
  mockGetSession,
  mockStartAuthentication,
  mockStartRegistration,
} = vi.hoisted(() => ({
  mockHandleAuthFailure: vi.fn(),
  mockBrowserSupportsWebAuthn: vi.fn(),
  mockGetSession: vi.fn(),
  mockStartAuthentication: vi.fn(),
  mockStartRegistration: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mockBrowserSupportsWebAuthn,
  startAuthentication: mockStartAuthentication,
  startRegistration: mockStartRegistration,
}));

vi.mock("next-auth/react", () => ({
  getSession: mockGetSession,
}));

vi.mock("./auth-failure", () => ({
  handleAuthFailure: mockHandleAuthFailure,
}));

import {
  isPasskeySupported,
  isPasskeyCeremonyIncompleteError,
  listPasskeys,
  loginWithPasskey,
  registerPasskey,
  revokePasskey,
  startPasskeyEnrollment,
} from "./passkey-api";
import { clearSessionCache } from "./session-cache";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

// The browser session carries no token (#5005); the BFF routes read the
// session cookie.
function mockAuthenticatedSession() {
  mockGetSession.mockResolvedValue({
    user: { id: "1" },
  });
}

describe("passkey-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionCache();
    global.fetch = vi.fn();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockHandleAuthFailure.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports browser WebAuthn support", () => {
    mockBrowserSupportsWebAuthn.mockReturnValueOnce(false);

    expect(isPasskeySupported()).toBe(false);
    expect(mockBrowserSupportsWebAuthn).toHaveBeenCalledTimes(1);
  });

  it("identifies passkey ceremonies that did not complete", () => {
    expect(
      isPasskeyCeremonyIncompleteError(
        new DOMException("User cancelled the request", "AbortError"),
      ),
    ).toBe(true);
    expect(
      isPasskeyCeremonyIncompleteError(
        new DOMException(
          "The operation either timed out or was not allowed.",
          "NotAllowedError",
        ),
      ),
    ).toBe(true);
    // The ceremony is identified by the error name, never by its text.
    expect(
      isPasskeyCeremonyIncompleteError(
        new Error("The operation either timed out or was not allowed."),
      ),
    ).toBe(false);
    expect(
      isPasskeyCeremonyIncompleteError(
        new Error("Passkey-Anfrage fehlgeschlagen."),
      ),
    ).toBe(false);
  });

  it("runs tenant passkey login through options, WebAuthn, and verify", async () => {
    mockStartAuthentication.mockResolvedValue({ id: "assertion-id" });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          session_id: "login-session",
          options: { publicKey: { challenge: "tenant-challenge" } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: { status: "authenticated" },
        }),
      );

    const result = await loginWithPasskey("tenant", {
      tenantSlug: "school-a",
    });

    expect(result).toEqual({
      status: "authenticated",
    });
    expect(mockStartAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "tenant-challenge" },
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/auth/passkeys/login/options",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ tenant_slug: "school-a" }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/passkeys/login/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "login-session",
          response: { id: "assertion-id" },
        }),
      }),
    );
  });

  it("uses the operator passkey login endpoints", async () => {
    mockStartAuthentication.mockResolvedValue({ id: "operator-assertion" });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          session_id: "operator-login",
          options: { challenge: "operator-challenge" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: { status: "authenticated" },
        }),
      );

    await expect(loginWithPasskey("operator")).resolves.toEqual({
      status: "authenticated",
    });

    expect(mockStartAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "operator-challenge" },
    });
    expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
      "/api/operator/auth/passkeys/login/options",
    );
    expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toBe(
      "/api/operator/auth/passkeys/login/verify",
    );
  });

  it("uses the caterer passkey endpoints (#4497)", async () => {
    mockAuthenticatedSession();
    mockStartAuthentication.mockResolvedValue({ id: "caterer-assertion" });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          session_id: "caterer-login",
          options: { challenge: "caterer-challenge" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: { status: "authenticated" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { status: "success", data: [] }),
      );

    await loginWithPasskey("caterer");
    await listPasskeys("caterer");

    const urls = vi.mocked(global.fetch).mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "/api/caterer/auth/passkeys/login/options",
      "/api/caterer/auth/passkeys/login/verify",
      "/api/caterer/auth/passkeys",
    ]);
  });

  it("starts authenticated enrollment without a bearer token", async () => {
    mockAuthenticatedSession();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        status: "success",
        data: {
          challenge_token: "challenge-token",
          masked_email: "a***@example.test",
        },
      }),
    );

    const result = await startPasskeyEnrollment("tenant");

    expect(result.masked_email).toBe("a***@example.test");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/passkeys/enrollment/challenge",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each(["tenant", "operator"] as const)(
    "returns an incorrect enrollment code in %s without renewal, retry, or navigation",
    async (scope) => {
      mockAuthenticatedSession();
      const path = scope === "tenant" ? "/settings" : "/operator/settings";
      const location = { pathname: path, href: path };
      vi.stubGlobal("window", { location });
      vi.mocked(global.fetch).mockImplementation(async () =>
        jsonResponse(401, { code: "identity.mfa_code_invalid" }),
      );

      await expect(
        registerPasskey(scope, { code: "000000", name: "Laptop" }),
      ).rejects.toMatchObject({
        status: 401,
        code: "identity.mfa_code_invalid",
      });

      expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
        scope === "tenant"
          ? "/api/auth/passkeys/register/options"
          : "/api/operator/auth/passkeys/register/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ code: "000000", name: "Laptop" }),
        }),
      );
      expect(location.href).toBe(path);
      expect(mockHandleAuthFailure).not.toHaveBeenCalled();
      expect(mockStartRegistration).not.toHaveBeenCalled();
    },
  );

  it("runs registration through options, WebAuthn, and verify", async () => {
    mockAuthenticatedSession();
    mockStartRegistration.mockResolvedValue({ id: "registration-id" });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: {
            session_id: "registration-session",
            options: { publicKey: { challenge: "registration-challenge" } },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: {
            id: "12",
            name: "MacBook",
            created_at: "2026-06-15T10:00:00Z",
          },
        }),
      );

    const result = await registerPasskey("operator", {
      code: "123456",
      name: "MacBook",
    });

    expect(result.id).toBe("12");
    expect(mockStartRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "registration-challenge" },
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/operator/auth/passkeys/register/options",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456", name: "MacBook" }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/operator/auth/passkeys/register/verify",
      expect.objectContaining({
        body: JSON.stringify({
          session_id: "registration-session",
          name: "MacBook",
          response: { id: "registration-id" },
        }),
      }),
    );
  });

  it("reads the staff portal's passkey list in the catalog proxy's envelope (#2352)", async () => {
    mockAuthenticatedSession();
    const passkey = {
      id: "7",
      name: "Phone",
      created_at: "2026-06-15T10:00:00Z",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(200, { status: "success", data: [passkey] }),
    );

    await expect(listPasskeys("tenant")).resolves.toEqual([passkey]);
  });

  it("lists and revokes passkeys with authenticated requests", async () => {
    mockAuthenticatedSession();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "success",
          data: [
            {
              id: "7",
              name: "Phone",
              created_at: "2026-06-15T10:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(listPasskeys("tenant")).resolves.toHaveLength(1);
    await expect(revokePasskey("tenant", "7")).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/auth/passkeys",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/passkeys/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws a login error when no authenticated session token exists", async () => {
    mockGetSession.mockResolvedValue({ user: {}, error: "RefreshTokenError" });

    await expect(listPasskeys("tenant")).rejects.toMatchObject({
      status: 401,
      message: "Nicht angemeldet.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ detail: "Direkter Fehler" }, "Direkter Fehler"],
    [{ message: "Backend-Nachricht" }, undefined],
    [{ error_text: "Legacy-Fehler" }, undefined],
  ])(
    "keeps the diagnostic separate from the enrollment fallback: %j",
    async (body, detail) => {
      mockAuthenticatedSession();
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(403, body));

      await expect(startPasskeyEnrollment("tenant")).rejects.toMatchObject({
        status: 403,
        message: "Passkey-Anfrage fehlgeschlagen.",
        detail,
      });
    },
  );

  it("preserves a stable backend error code", async () => {
    mockAuthenticatedSession();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(403, {
        detail: "school portal accounts must log in at the school portal",
        code: "identity.use_school_portal",
      }),
    );

    await expect(startPasskeyEnrollment("tenant")).rejects.toMatchObject({
      status: 403,
      code: "identity.use_school_portal",
    });
  });

  it("falls back when an error response is not parseable JSON", async () => {
    mockAuthenticatedSession();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      textResponse(502, "gateway down"),
    );

    const promise = startPasskeyEnrollment("tenant");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 502,
      message: "Passkey-Anfrage fehlgeschlagen.",
    });
  });
});
