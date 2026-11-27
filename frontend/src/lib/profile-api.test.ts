import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as meContract from "./contract/me.generated";
import type { Profile } from "./profile-helpers";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

// Import after mocks are set up
import { ApiError } from "./api-error";
import * as sessionCache from "./session-cache";
import { fetchProfile, updateProfile, uploadAvatar } from "./profile-api";

// Type-safe mocks

/** The staff session gate refuses before any request leaves. */
function refuseSession(
  error: unknown = new ApiError("Authentication required", 401, {
    code: "general.permission",
  }),
) {
  vi.spyOn(sessionCache, "requireTenantSession").mockRejectedValueOnce(error);
}

// Sample data
const sampleProfileWire: meContract.ProfileResponse = {
  id: "123",
  first_name: "Max",
  last_name: "Mustermann",
  email: "max@example.com",
  username: "maxmuster",
  avatar: "/uploads/avatars/global/avatar.jpg",
  bio: "Test bio",
  rfid_card: "CARD001",
  settings: '{"theme":"dark"}',
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T12:00:00Z",
  version: "v1",
  last_login: "2024-01-20T10:00:00Z",
};

const sampleProfile: Profile = {
  firstName: "Max",
  lastName: "Mustermann",
  email: "max@example.com",
  avatar: "/api/me/profile/avatar/avatar.jpg",
  version: "v1",
};

const sampleUpdateRequest = {
  firstName: "Max",
  lastName: "Mustermann",
  expectedVersion: "v1",
};

describe("profile-api", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("fetchProfile", () => {
    it("fetches profile successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "success",
            message: "Profile fetched",
            data: sampleProfileWire,
          }),
      });
      global.fetch = mockFetch;

      const result = await fetchProfile();

      expect(mockFetch).toHaveBeenCalledWith("/api/me/profile", {
        method: "GET",
      });
      expect(result).toEqual(sampleProfile);
    });

    it("throws error when no token is available", async () => {
      refuseSession();

      await expect(fetchProfile()).rejects.toThrow("Authentication required");
    });

    it("throws error when session has no user", async () => {
      // The gate refuses a session without access like a missing one.
      refuseSession();

      await expect(fetchProfile()).rejects.toThrow("Authentication required");
    });

    it("throws error when the session was stripped", async () => {
      // The gate refuses a session without access like a missing one.
      refuseSession();

      await expect(fetchProfile()).rejects.toThrow("Authentication required");
    });

    it("throws error when response is not ok", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch;

      await expect(fetchProfile()).rejects.toMatchObject({
        status: 404,
        code: "general.input",
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to fetch profile", {
        error: expect.any(String) as unknown,
      });
    });

    it("throws generic error when fetch fails", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      await expect(fetchProfile()).rejects.toThrow("Network error");
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to fetch profile", {
        error: expect.stringContaining("Network error") as unknown,
      });
    });
  });

  describe("updateProfile", () => {
    it("updates profile successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "success",
            message: "Profile updated",
            data: sampleProfileWire,
          }),
      });
      global.fetch = mockFetch;

      const result = await updateProfile(sampleUpdateRequest);

      expect(mockFetch).toHaveBeenCalledWith("/api/me/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: "Max",
          last_name: "Mustermann",
          expected_version: "v1",
        }),
      });
      expect(result).toEqual(sampleProfile);
    });

    it("throws error when no token is available", async () => {
      refuseSession();

      await expect(updateProfile(sampleUpdateRequest)).rejects.toThrow(
        "Authentication required",
      );
    });

    it("throws error when response is not ok", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });
      global.fetch = mockFetch;

      // #2517: an ApiError with the status class, for the catalog text.
      await expect(updateProfile(sampleUpdateRequest)).rejects.toMatchObject({
        status: 400,
        code: "general.input",
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to update profile", {
        error: expect.any(String) as unknown,
      });
    });

    it("throws generic error when fetch fails", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      // The transport turns this into general.unavailable; the client
      // passes it on with the cause's message.
      await expect(updateProfile(sampleUpdateRequest)).rejects.toThrow(
        "Network error",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to update profile", {
        error: expect.stringContaining("Network error") as unknown,
      });
    });
  });

  describe("uploadAvatar", () => {
    const mockFile = new File(["avatar"], "avatar.jpg", { type: "image/jpeg" });

    it("uploads avatar successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "success",
            message: "Avatar uploaded",
            data: sampleProfileWire,
          }),
      });
      global.fetch = mockFetch;

      await uploadAvatar(mockFile);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/me/profile/avatar",
        expect.objectContaining({
          method: "POST",
        }),
      );

      // Verify FormData was created with the file; the route reads the
      // session cookie, so no Authorization header goes out (#5005).
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.[1]?.headers).toBeUndefined();
      const body = callArgs?.[1]?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("avatar")).toBe(mockFile);
    });

    it("throws error when no token is available", async () => {
      refuseSession();

      await expect(uploadAvatar(mockFile)).rejects.toThrow(
        "Authentication required",
      );
    });

    it("throws error with message from response when upload fails", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(JSON.stringify({ detail: "File too large" })),
      });
      global.fetch = mockFetch;

      // #2517: the backend sentence stays a diagnostic; the caller gets the
      // status class for the catalog text.
      await expect(uploadAvatar(mockFile)).rejects.toMatchObject({
        status: 400,
        code: "general.input",
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to upload avatar", {
        error: expect.any(String) as unknown,
      });
    });

    it("throws error with status when JSON parsing fails", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("Parse error")),
      });
      global.fetch = mockFetch;

      await expect(uploadAvatar(mockFile)).rejects.toMatchObject({
        status: 500,
      });
    });

    it("preserves error message when fetch throws Error", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Custom network error"));
      global.fetch = mockFetch;

      await expect(uploadAvatar(mockFile)).rejects.toThrow(
        "Custom network error",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith("failed to upload avatar", {
        error: expect.stringContaining("Custom network error") as unknown,
      });
    });

    it("throws generic error when fetch throws non-Error", async () => {
      const mockFetch = vi.fn().mockRejectedValue("String error");
      global.fetch = mockFetch;

      await expect(uploadAvatar(mockFile)).rejects.toMatchObject({
        code: "general.unavailable",
      });
    });
  });
});
