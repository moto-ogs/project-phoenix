import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ApiError } from "./api-error";
import { requestPasswordReset, confirmPasswordReset } from "./auth-api";

/** A failed answer of the BFF, as the browser's fetch resolves it. */
function failure(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

describe("auth-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("requestPasswordReset", () => {
    it("posts the address to the reset endpoint", async () => {
      global.fetch = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(null, { status: 204 })),
        );

      await requestPasswordReset("tenant", "test@example.com");

      expect(global.fetch).toHaveBeenCalledWith("/api/auth/password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "test@example.com" }),
        credentials: "include",
        cache: "no-store",
      });
    });

    it("throws ApiError with JSON error message", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Rate limit exceeded" }), {
          "Content-Type": "application/json",
          "Retry-After": "60",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toThrow("Fehler beim Senden der Passwort-Zurücksetzen-E-Mail");
    });

    // A plain-text body (a proxy in front of the BFF) stays a diagnostic:
    // the error keeps its status and the client's message (#7806).
    it("throws ApiError with the status and fallback message for a text body", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(500, "Internal server error", {
          "Content-Type": "text/plain",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toMatchObject({
        status: 500,
        code: "general.server",
        message: "Fehler beim Senden der Passwort-Zurücksetzen-E-Mail",
      });
    });

    it("throws ApiError with retryAfterSeconds from Retry-After header (numeric)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
          "Retry-After": "120",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await requestPasswordReset("tenant", "test@example.com");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(429);
        expect(apiError.retryAfterSeconds).toBe(120);
      }
    });

    it("throws ApiError with retryAfterSeconds from Retry-After header (date)", async () => {
      const futureDate = new Date(Date.now() + 30000); // 30 seconds from now

      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
          "Retry-After": futureDate.toUTCString(),
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await requestPasswordReset("tenant", "test@example.com");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(429);
        expect(apiError.retryAfterSeconds).toBeGreaterThan(0);
        expect(apiError.retryAfterSeconds).toBeLessThanOrEqual(31);
      }
    });

    it("handles response parse failure gracefully", async () => {
      global.fetch = vi.fn().mockResolvedValue(failure(500, "{not json", {}));

      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toThrow("Fehler beim Senden der Passwort-Zurücksetzen-E-Mail");
    });
  });

  describe("each portal's own endpoints", () => {
    it.each([
      ["tenant", "/api/auth"],
      ["parent", "/api/parent/auth"],
      ["school", "/api/school/auth"],
      ["caterer", "/api/caterer/auth"],
      ["traeger", "/api/traeger/auth"],
    ] as const)(
      "%s posts the request and the confirmation under %s",
      async (portal, base) => {
        global.fetch = vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(new Response(null, { status: 204 })),
          );

        await requestPasswordReset(portal, "person@example.com");
        await confirmPasswordReset(
          portal,
          "token",
          "Str0ngP@ss1",
          "Str0ngP@ss1",
        );

        expect(global.fetch).toHaveBeenNthCalledWith(
          1,
          `${base}/password-reset`,
          expect.objectContaining({
            body: JSON.stringify({ email: "person@example.com" }),
          }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
          2,
          `${base}/password-reset/confirm`,
          expect.objectContaining({
            body: JSON.stringify({
              token: "token",
              new_password: "Str0ngP@ss1",
              confirm_password: "Str0ngP@ss1",
            }),
          }),
        );
      },
    );
  });

  describe("confirmPasswordReset", () => {
    it("throws a typed ApiError carrying the backend status on failure", async () => {
      // The reset page shows the catalog text of the code; the status and
      // the backend's detail stay on the error for the log.
      global.fetch = vi.fn().mockResolvedValue(
        failure(410, JSON.stringify({ detail: "Token expired" }), {
          "Content-Type": "application/json",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await confirmPasswordReset(
          "parent",
          "expired",
          "Str0ngP@ss1",
          "Str0ngP@ss1",
        );
        expect.fail("expected confirmPasswordReset to reject");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(410);
        expect(apiError.message).toBe("Fehler beim Zurücksetzen des Passworts");
        expect(apiError.detail).toBe("Token expired");
      }
    });
  });

  describe("parseRetryAfter (via buildApiError)", () => {
    it("handles null Retry-After header", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      const error = await requestPasswordReset(
        "tenant",
        "test@example.com",
      ).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ status: 429 });
      expect((error as ApiError).retryAfterSeconds).toBeUndefined();
    });

    it("handles negative numeric Retry-After (clamps to 0)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
          "Retry-After": "-10",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await requestPasswordReset("tenant", "test@example.com");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.retryAfterSeconds).toBe(0);
      }
    });

    it("handles past date Retry-After (returns 0)", async () => {
      const pastDate = new Date(Date.now() - 30000); // 30 seconds in past

      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
          "Retry-After": pastDate.toUTCString(),
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await requestPasswordReset("tenant", "test@example.com");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.retryAfterSeconds).toBe(0);
      }
    });

    it("handles invalid Retry-After value (not number or date)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(429, JSON.stringify({ detail: "Too many requests" }), {
          "Content-Type": "application/json",
          "Retry-After": "invalid-value",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      const error = await requestPasswordReset(
        "tenant",
        "test@example.com",
      ).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ status: 429 });
      expect((error as ApiError).retryAfterSeconds).toBeUndefined();
    });
  });

  describe("buildApiError (via requestPasswordReset)", () => {
    it("reads structured fields from application/problem+json", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(
          409,
          JSON.stringify({
            detail: "Conflict",
            code: "identity.email_conflict",
            details: { account_id: "42" },
            errors: [{ field: "email", reason: "duplicate" }],
            instance: "request-auth-409",
          }),
          { "Content-Type": "application/problem+json" },
        ),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toMatchObject({
        status: 409,
        code: "identity.email_conflict",
        details: { account_id: "42" },
        errors: [{ field: "email", reason: "duplicate" }],
        requestId: "request-auth-409",
      });
    });

    it("does not read a legacy message field as the diagnostic", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(400, JSON.stringify({ message: "Email not found" }), {
          "Content-Type": "application/json",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toThrow("Fehler beim Senden der Passwort-Zurücksetzen-E-Mail");
    });

    it("uses fallback message for empty JSON response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(500, JSON.stringify({}), {
          "Content-Type": "application/json",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toThrow("Fehler beim Senden der Passwort-Zurücksetzen-E-Mail");
    });

    it("uses fallback for empty text response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failure(500, "   ", {
          "Content-Type": "text/plain",
        }),
      );

      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        requestPasswordReset("tenant", "test@example.com"),
      ).rejects.toThrow("Fehler beim Senden der Passwort-Zurücksetzen-E-Mail");
    });
  });
});
