/**
 * Tests for usercontext-api.ts
 *
 * Tests the userContextService functions:
 * - hasEducationalGroups
 * - getCurrentUser
 * - getCurrentStaff
 * - getMyActiveGroups
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { plainResponse } from "~/test/mocks/plain-session-fetch";

// Mock dependencies
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(() =>
    Promise.resolve({
      user: { id: "1" },
    }),
  ),
}));

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

// Import after mocking
import { userContextService } from "./usercontext-api";

describe("userContextService", () => {
  const originalFetch = globalThis.fetch;
  const fetchWithAuthMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchWithAuthMock;
    // Simulate browser environment
    Object.defineProperty(globalThis, "window", {
      value: {},
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Reset window to undefined for server-side tests
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  describe("getCurrentStaff", () => {
    it("returns mapped staff profile on success", async () => {
      const backendData = {
        id: "10",
        person_id: "100",
      };

      fetchWithAuthMock.mockImplementationOnce(() =>
        plainResponse({
          ok: true,
          json: () => Promise.resolve({ status: "success", data: backendData }),
        } as Response),
      );

      const result = await userContextService.getCurrentStaff();

      expect(result.id).toBe("10");
      expect(result.person_id).toBe("100");
    });

    it("throws error for 404 without console spam", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      fetchWithAuthMock.mockImplementationOnce(() =>
        plainResponse({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        } as Response),
      );

      await expect(userContextService.getCurrentStaff()).rejects.toMatchObject({
        status: 404,
      });

      // Should not have logged "Get current staff error:" for 404
      const errorCalls = consoleSpy.mock.calls.filter(
        (call: unknown[]) =>
          String(call[0]).includes("Get current staff error:") &&
          !String(call[0]).includes("404"),
      );
      expect(errorCalls.length).toBe(0);

      consoleSpy.mockRestore();
    });
  });
});
