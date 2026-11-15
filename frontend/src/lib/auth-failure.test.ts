import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleAuthFailure, refreshToken } from "./auth-failure";
import { runTenantSessionEnd } from "./tenant-session-end";

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

// Helper to setup browser environment
function setupBrowserEnv() {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { location: { href: "" } },
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  };
}

// Helper to setup server environment
function setupServerEnv() {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: undefined,
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  };
}

describe("auth-failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear sessionStorage
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("refreshToken", () => {
    it("reports a renewed session without reading tokens (#5005)", async () => {
      const restore = setupBrowserEnv();
      try {
        const json = vi.fn();
        global.fetch = vi
          .fn()
          .mockResolvedValue({ ok: true, status: 204, json });

        const result = await refreshToken();

        expect(result).toBe(true);
        expect(json).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        });
      } finally {
        restore();
      }
    });

    it("returns false when refresh fails with non-ok response", async () => {
      const restore = setupBrowserEnv();
      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        });

        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const result = await refreshToken();

        expect(result).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns false when fetch throws error", async () => {
      const restore = setupBrowserEnv();
      try {
        const networkError = new Error("Network error");
        global.fetch = vi.fn().mockRejectedValue(networkError);

        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const result = await refreshToken();

        expect(result).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns false when called from server context", async () => {
      const restore = setupServerEnv();
      try {
        global.fetch = vi.fn();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const result = await refreshToken();

        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("deduplicates concurrent refresh requests", async () => {
      const restore = setupBrowserEnv();
      try {
        // Use a delayed response to ensure both calls happen while first is pending
        let resolvePromise: (value: unknown) => void;
        const fetchPromise = new Promise((resolve) => {
          resolvePromise = resolve;
        });

        global.fetch = vi.fn().mockReturnValue(fetchPromise);

        // Start two refresh requests concurrently
        const promise1 = refreshToken();
        const promise2 = refreshToken();

        // Now resolve the fetch
        resolvePromise!({ ok: true, status: 204 });

        const [result1, result2] = await Promise.all([promise1, promise2]);

        // Both should get the same result
        expect(result1).toBe(true);
        expect(result2).toBe(true);

        // But fetch should only be called once
        expect(global.fetch).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });
  });

  describe("handleAuthFailure", () => {
    it("does not start refresh or signout while an explicit tenant logout owns the session", async () => {
      let finish!: () => void;
      const flight = runTenantSessionEnd(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await Promise.resolve();
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401 }));
      vi.stubGlobal("fetch", fetch);
      try {
        expect(await handleAuthFailure()).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        finish();
        await flight;
        vi.unstubAllGlobals();
      }
    });
    it("returns false in server context", async () => {
      const restore = setupServerEnv();
      try {
        const result = await handleAuthFailure();

        expect(result).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns true immediately if recently refreshed (within 5 seconds)", async () => {
      const restore = setupBrowserEnv();
      try {
        // Mock sessionStorage using Object.defineProperty for reliable mocking
        const lastRefreshTime = (Date.now() - 2000).toString(); // 2 seconds ago
        const getItemMock = vi.fn().mockImplementation((key: string) => {
          if (key === "lastSuccessfulRefresh") {
            return lastRefreshTime;
          }
          return null;
        });
        Object.defineProperty(globalThis, "sessionStorage", {
          value: { getItem: getItemMock, setItem: vi.fn(), clear: vi.fn() },
          writable: true,
          configurable: true,
        });

        global.fetch = vi.fn();
        const result = await handleAuthFailure();

        expect(result).toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("attempts token refresh when not recently refreshed", async () => {
      const restore = setupBrowserEnv();
      try {
        const mockTokens = {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
        };

        // No recent refresh - use a function mock that checks for the specific key
        const getItemMock = vi.fn().mockImplementation((key: string) => {
          if (key === "lastSuccessfulRefresh") {
            return null;
          }
          return null;
        });
        const setItemMock = vi.fn();
        Object.defineProperty(globalThis, "sessionStorage", {
          value: { getItem: getItemMock, setItem: setItemMock, clear: vi.fn() },
          writable: true,
        });

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockTokens),
        });

        const result = await handleAuthFailure();

        expect(result).toBe(true);
        // After Fix 4: no signIn call — JWT callback already persisted tokens
        // via auth() in /api/auth/token. Just verify sessionStorage was updated.
        expect(setItemMock).toHaveBeenCalledWith(
          "lastSuccessfulRefresh",
          expect.any(String),
        );
      } finally {
        restore();
      }
    });

    it("attempts token refresh when the previous successful refresh is stale", async () => {
      const restore = setupBrowserEnv();
      try {
        const mockTokens = {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
        };
        const getItemMock = vi.fn().mockImplementation((key: string) => {
          if (key === "lastSuccessfulRefresh") {
            return (Date.now() - 10_000).toString();
          }
          return null;
        });
        const setItemMock = vi.fn();
        Object.defineProperty(globalThis, "sessionStorage", {
          value: { getItem: getItemMock, setItem: setItemMock, clear: vi.fn() },
          writable: true,
        });

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockTokens),
        });

        const result = await handleAuthFailure();

        expect(result).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/token",
          expect.any(Object),
        );
        expect(setItemMock).toHaveBeenCalledWith(
          "lastSuccessfulRefresh",
          expect.any(String),
        );
      } finally {
        restore();
      }
    });

    it("signs out and redirects when token refresh fails", async () => {
      const restore = setupBrowserEnv();
      try {
        // No recent refresh
        const getItemMock = vi.fn().mockReturnValue(null);
        Object.defineProperty(globalThis, "sessionStorage", {
          value: { getItem: getItemMock, setItem: vi.fn(), clear: vi.fn() },
          writable: true,
        });

        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        });

        const { signOut } = await import("next-auth/react");
        vi.mocked(signOut).mockResolvedValue({ url: "/" });

        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const result = await handleAuthFailure();

        expect(result).toBe(false);
        expect(signOut).toHaveBeenCalledWith({ redirect: false });
        expect(globalThis.window.location.href).toBe("/");
      } finally {
        restore();
      }
    });

    it("handles errors during auth failure handling", async () => {
      const restore = setupBrowserEnv();
      try {
        // Mock sessionStorage to throw error
        Object.defineProperty(globalThis, "sessionStorage", {
          value: {
            getItem: vi.fn().mockImplementation(() => {
              throw new Error("Storage error");
            }),
            setItem: vi.fn(),
            clear: vi.fn(),
          },
          writable: true,
        });

        const { signOut } = await import("next-auth/react");
        vi.mocked(signOut).mockResolvedValue({ url: "/" });

        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const result = await handleAuthFailure();

        expect(result).toBe(false);
        expect(signOut).toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });
});
