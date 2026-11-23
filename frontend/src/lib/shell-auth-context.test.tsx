import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

// Use vi.hoisted for mock values referenced in vi.mock
const {
  mockShowLogoutError,
  mockUseSession,
  mockSignOut,
  mockClearSessionCache,
  mockEndStaffPreview,
  mockSchoolPortalLoginUrl,
} = vi.hoisted(() => ({
  mockShowLogoutError: vi.fn(),
  mockUseSession: vi.fn(),
  mockSignOut: vi.fn(),
  mockClearSessionCache: vi.fn(),
  mockEndStaffPreview: vi.fn(),
  mockSchoolPortalLoginUrl: vi.fn(),
}));

const mockProfile = {
  firstName: "John",
  lastName: "Doe",
  avatar: "/avatar.jpg",
};

interface MockSessionReturn {
  data: {
    user?: {
      name?: string;
      email?: string;
      roles?: string[];
    };
    error?: string;
  } | null;
  status: "authenticated" | "loading" | "unauthenticated";
}

vi.mock("~/lib/tenant-session-cookie", () => ({ signOutTenant: mockSignOut }));

vi.mock("next-auth/react", () => ({
  useSession: (): MockSessionReturn => mockUseSession() as MockSessionReturn,
  signOut: mockSignOut,
}));

vi.mock("~/contexts/ToastContext", () => ({
  useApiErrorDisplay: () => ({ show: mockShowLogoutError }),
}));

vi.mock("~/lib/profile-context", () => ({
  useProfile: () => ({ profile: mockProfile }),
}));

vi.mock("~/lib/operator-url", () => ({
  operatorAbsoluteUrl: (path: string) => path,
  operatorPath: (path: string) => path,
}));

vi.mock("~/lib/school-url", () => ({
  schoolAbsoluteUrl: (path: string) => path,
  schoolPath: (path: string) => path,
  schoolPortalLoginUrl: mockSchoolPortalLoginUrl,
}));

vi.mock("~/lib/session-cache", () => ({
  clearSessionCache: mockClearSessionCache,
  DELIBERATE_LOGOUT_KEY: "deliberateLogout",
  LOGOUT_NOT_REVOKED_KEY: "logoutNotRevoked",
}));

vi.mock("~/lib/staff-preview-api", () => ({
  recordStaffPreviewEnd: mockEndStaffPreview,
}));

vi.mock("~/lib/swr", () => ({
  mutate: vi.fn(),
}));

vi.mock("~/lib/parent-url", () => ({
  parentAbsoluteUrl: (path: string) => path,
  parentPath: (path: string) => path,
}));

vi.mock("~/lib/caterer-url", () => ({
  catererAbsoluteUrl: (path: string) => path,
  catererPath: (path: string) => path,
}));

import {
  TeacherShellProvider,
  OperatorShellProvider,
  ParentShellProvider,
  SchoolShellProvider,
  CatererShellProvider,
  endTraegerSession,
  useShellAuth,
} from "./shell-auth-context";
import { installSessionEndBarrier } from "./session-end-state";
import { LOGOUT_NOT_REVOKED_KEY } from "./session-cache";
import { portalAuthPath, portalLoginPath } from "./portal-paths";
import { sidebarMemoryKey } from "./sidebar-memory";
import { ApiError } from "./api-error";
import { errorLogFields } from "./error-log";

describe("TeacherShellProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    mockSchoolPortalLoginUrl.mockReturnValue(
      "https://schule.example.test/login",
    );
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <TeacherShellProvider>{children}</TeacherShellProvider>
  );

  it("provides authenticated teacher data", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "John Doe",
          email: "john@example.com",
          roles: ["teacher", "admin"],
          permissions: ["schedules:read"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user).toEqual({
      name: "John Doe",
      email: "john@example.com",
      roles: ["teacher", "admin"],
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.isSessionExpired).toBe(false);
    expect(result.current.mode).toBe("teacher");
    // Das Logo führt für jede Rolle auf die Startseite (#2180).
    expect(result.current.homeUrl).toBe("/home");
    expect(result.current.profileUrl).toBe("/profile");
  });

  it("keeps the start page as home for admin-only accounts (#2180)", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Admin Only",
          email: "admin@example.com",
          roles: ["admin"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.homeUrl).toBe("/home");
  });

  it("keeps the start page as home for caregivers without schedules:read (#2180)", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Ohne Recht",
          email: "user@example.com",
          roles: ["user"],
          permissions: [],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.homeUrl).toBe("/home");
  });

  it("hands existing school-only sessions to the school portal", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Lehrkraft",
          email: "lehrkraft@example.com",
          roles: ["lehrkraft"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.homeUrl).toBe("/school/login");
    expect(mockSchoolPortalLoginUrl).not.toHaveBeenCalled();
  });

  it("keeps the school-only hand-off safe during server rendering", () => {
    mockSchoolPortalLoginUrl.mockImplementation(() => {
      throw new Error("schoolPortalLoginUrl() is client-only.");
    });
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Lehrkraft",
          email: "lehrkraft@example.com",
          roles: ["lehrkraft"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.homeUrl).toBe("/school/login");
    expect(mockSchoolPortalLoginUrl).not.toHaveBeenCalled();
  });

  it("keeps dual-role lehrkraft accounts in the staff portal", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Lehrkraft mit Betreuung",
          email: "lehrkraft@example.com",
          roles: ["lehrkraft", "user"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.homeUrl).toBe("/home");
  });

  it("provides profile data from context", () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "Test", email: "test@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.profile).toEqual({
      firstName: "John",
      lastName: "Doe",
      avatar: "/avatar.jpg",
    });
  });

  it("handles loading state", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(result.current.user).toBeNull();
  });

  it("handles unauthenticated state", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });

  it("uses fallback name when user name is empty", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "   ",
          email: "user@example.com",
          roles: [],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Benutzer");
  });

  it("uses fallback name when user name is undefined", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: undefined,
          email: "user@example.com",
          roles: [],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Benutzer");
  });

  // Ein Konto ohne Personendaten trägt im Sitzungsnamen seine Adresse; die
  // Kopfzeile zeigt sie nur im Profil-Menü, nie als Namen (#7305).
  it("never shows the sign-in address as the name", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "petra@traeger.de",
          email: "petra@traeger.de",
          roles: ["admin"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Benutzer");
    expect(result.current.user?.email).toBe("petra@traeger.de");
  });

  it("detects expired session", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: "User", email: "user@example.com", roles: [] },
        error: "RefreshTokenExpired",
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.isSessionExpired).toBe(true);
  });

  it("deletes the tenant cookie with cancellation and navigates on logout", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", mockFetch);
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    try {
      const { result } = renderHook(() => useShellAuth(), { wrapper });

      await result.current.logout();

      expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        signal: expect.any(AbortSignal) as AbortSignal,
        credentials: "include",
        cache: "no-store",
      });
      expect(mockSignOut).toHaveBeenCalledWith(
        { callbackUrl: "/" },
        expect.any(AbortSignal),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fires backend logout and clears session cache on teacher logout", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", mockFetch);

    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await result.current.logout();

    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      signal: expect.any(AbortSignal) as AbortSignal,
      credentials: "include",
      cache: "no-store",
    });
    expect(mockClearSessionCache).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  // Abmelden aus einer laufenden Vorschau (#2893): die Vorschau endet damit
  // genauso wie per Klick — und muss deshalb auch im Protokoll enden, bevor
  // der Logout die Admin-Familie widerruft.
  it("ends a running staff preview before logging out", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", mockFetch);
    mockEndStaffPreview.mockResolvedValue(undefined);
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Erika Beispiel",
          email: "erika@example.com",
          roles: [],
          isPreview: true,
        },
      },
      status: "authenticated",
    });

    try {
      const { result } = renderHook(() => useShellAuth(), { wrapper });

      await result.current.logout();

      // Das Vorschau-Token liegt nur im Sitzungs-Cookie (#5005): das Ende
      // muss im Protokoll stehen, bevor der Logout die Sitzung löscht.
      expect(mockEndStaffPreview).toHaveBeenCalledOnce();
      expect(mockSignOut).toHaveBeenCalledWith(
        { callbackUrl: "/" },
        expect.any(AbortSignal),
      );
      expect(mockEndStaffPreview.mock.invocationCallOrder[0]).toBeLessThan(
        mockSignOut.mock.invocationCallOrder[0]!,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not end a preview on a regular logout", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", mockFetch);
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    try {
      const { result } = renderHook(() => useShellAuth(), { wrapper });
      await result.current.logout();
      expect(mockEndStaffPreview).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("logs out even when ending the preview fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", mockFetch);
    mockEndStaffPreview.mockRejectedValue(new Error("audit endpoint down"));
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Erika Beispiel",
          email: "erika@example.com",
          roles: [],
          isPreview: true,
        },
      },
      status: "authenticated",
    });

    try {
      const { result } = renderHook(() => useShellAuth(), { wrapper });
      await result.current.logout();
      expect(mockSignOut).toHaveBeenCalledWith(
        { callbackUrl: "/" },
        expect.any(AbortSignal),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // #5194: only the revoked family ends the session's access tokens, so a
  // failed revocation keeps the session and reaches the caller instead of
  // passing for a logout.
  it("keeps the session when the logout route is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await expect(result.current.logout()).rejects.toThrow();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockClearSessionCache).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBeNull();

    vi.unstubAllGlobals();
  });

  // #7209: the person walks away believing they are signed out, so a
  // revocation the server refused still ends the session on this device;
  // the login page says that it ends at its expiry.
  it("ends the session on this device when the backend could not revoke it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            status: 503,
            detail: "logout could not revoke the session",
            code: "identity.logout_not_revoked",
          },
          { status: 503 },
        ),
      ),
    );
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });
    await result.current.logout();

    expect(mockSignOut).toHaveBeenCalledWith(
      { callbackUrl: "/" },
      expect.any(AbortSignal),
    );
    expect(mockClearSessionCache).toHaveBeenCalled();
    expect(mockShowLogoutError).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBe("1");

    vi.unstubAllGlobals();
    sessionStorage.removeItem(LOGOUT_NOT_REVOKED_KEY);
  });

  it("claims no ended session when the page leaves during the logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { status: 503, detail: "x", code: "identity.logout_not_revoked" },
            { status: 503 },
          ),
        ),
    );
    // The page leaves while the cookie deletion runs: the exit is cancelled.
    mockSignOut.mockImplementationOnce(() => {
      window.dispatchEvent(new Event("pagehide"));
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });
    await result.current.logout();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBeNull();

    vi.unstubAllGlobals();
  });

  it("claims no ended session when the cookie deletion fails after a refused revocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { status: 503, detail: "x", code: "identity.logout_not_revoked" },
            { status: 503 },
          ),
        ),
    );
    mockSignOut.mockRejectedValueOnce(new Error("signout failed"));
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await expect(result.current.logout()).rejects.toThrow();
    expect(mockShowLogoutError).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBeNull();

    vi.unstubAllGlobals();
  });

  // Sentry FRONTEND-1E: a stalled logout route timed out as a raw
  // DOMException, which the display classed as a crash without retry.
  it("shows a logout timeout as an unreachable service with retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("signal timed out", "TimeoutError"),
        ),
    );
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await expect(result.current.logout()).rejects.toThrow();
    expect(mockShowLogoutError).toHaveBeenCalledTimes(1);
    const [shown, options] = mockShowLogoutError.mock.calls[0] as [
      unknown,
      { retry?: unknown },
    ];
    expect(shown).toBeInstanceOf(ApiError);
    expect(shown).toMatchObject({
      code: "general.unavailable",
      noResponse: true,
    });
    expect(errorLogFields(shown).error_class).toBe("unavailable");
    expect(options.retry).toEqual(expect.any(Function));
    expect(mockSignOut).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("signs out when no session is left to revoke (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { status: 401, code: "general.permission" },
            { status: 401 },
          ),
        ),
    );
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });
    await result.current.logout();

    expect(mockSignOut).toHaveBeenCalledWith(
      { callbackUrl: "/" },
      expect.any(AbortSignal),
    );
    vi.unstubAllGlobals();
  });

  it("clears the Auth.js cookie only after the response-aware backend logout finishes", async () => {
    let finishBackendLogout: ((response: Response) => void) | undefined;
    const backendLogout = new Promise<Response>((resolve) => {
      finishBackendLogout = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(backendLogout));
    mockUseSession.mockReturnValue({
      data: { user: { name: "User", email: "user@example.com", roles: [] } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });
    const logout = result.current.logout();

    await Promise.resolve();
    expect(mockSignOut).not.toHaveBeenCalled();

    finishBackendLogout?.(new Response(null));
    await logout;

    expect(mockSignOut).toHaveBeenCalledWith(
      { callbackUrl: "/" },
      expect.any(AbortSignal),
    );
    vi.unstubAllGlobals();
  });

  it("provides empty roles array when not specified", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "User",
          email: "user@example.com",
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.roles).toEqual([]);
  });

  it("provides empty email when not specified", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "User",
          roles: [],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.email).toBe("");
  });
});

describe("OperatorShellProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    // The operator logout revokes its family first (#5194).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <OperatorShellProvider>{children}</OperatorShellProvider>
  );

  it("provides authenticated operator data", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Admin Operator",
          email: "admin@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user).toEqual({
      name: "Admin Operator",
      email: "admin@example.com",
      roles: ["operator"],
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.mode).toBe("operator");
    expect(result.current.homeUrl).toBe("/operator/organizations");
    expect(result.current.profileUrl).toBe("/operator/settings");
  });

  it("splits display name into first and last name", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "John Paul Jones",
          email: "john@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.profile).toEqual({
      firstName: "John",
      lastName: "Paul Jones",
    });
  });

  it("handles single word display name", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.profile).toEqual({
      firstName: "Admin",
      lastName: undefined,
    });
  });

  it("handles loading state", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(result.current.user).toBeNull();
  });

  it("handles unauthenticated state", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });

  it("reports session as not expired when no error", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Operator",
          email: "op@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.isSessionExpired).toBe(false);
  });

  it("detects expired session", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Operator",
          email: "op@example.com",
          roles: ["operator"],
        },
        error: "RefreshTokenExpired",
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.isSessionExpired).toBe(true);
  });

  it("uses fallback name when user name is empty", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "   ",
          email: "op@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Operator");
  });

  it("provides default roles when not specified", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Op",
          email: "op@example.com",
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.roles).toEqual(["operator"]);
  });

  it("calls signOut with operator login callbackUrl", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Operator",
          email: "op@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await result.current.logout();

    expect(mockSignOut).toHaveBeenCalledWith({
      callbackUrl: "/operator/login",
    });
  });

  it("clears session cache on operator logout", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Operator",
          email: "op@example.com",
          roles: ["operator"],
        },
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    await result.current.logout();

    expect(mockClearSessionCache).toHaveBeenCalled();
  });
});

describe("ParentShellProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A parent token carries no names; its session name is the username,
    // which is the account's address (#3891).
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "sabine.schneider@demo-7.example",
          email: "sabine.schneider@demo-7.example",
          roles: ["guardian"],
        },
      },
      status: "authenticated",
    });
  });

  it("names the parent after the guardian profile, not the session", () => {
    const { result } = renderHook(() => useShellAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ParentShellProvider
          accountName={{ firstName: "Florian", lastName: "Besuch" }}
        >
          {children}
        </ParentShellProvider>
      ),
    });

    expect(result.current.user?.name).toBe("Florian Besuch");
    expect(result.current.profile).toEqual({
      firstName: "Florian",
      lastName: "Besuch",
    });
  });

  it("never shows the address as the name while the profile is missing", () => {
    const { result } = renderHook(() => useShellAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ParentShellProvider>{children}</ParentShellProvider>
      ),
    });

    expect(result.current.user?.name).toBe("Eltern");
    expect(result.current.profile).toBeNull();
  });

  it("keeps a real session name when the profile has none", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Karin Klein",
          email: "karin@example.com",
          roles: ["guardian"],
        },
      },
      status: "authenticated",
    });
    const { result } = renderHook(() => useShellAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ParentShellProvider accountName={{}}>{children}</ParentShellProvider>
      ),
    });

    expect(result.current.user?.name).toBe("Karin Klein");
  });
});

describe("useShellAuth hook", () => {
  it("throws error when used outside provider", () => {
    expect(() => {
      renderHook(() => useShellAuth());
    }).toThrow("useShellAuth must be used within a ShellAuthProvider");
  });
});

describe("logout leaves no personal entries behind (#5000)", () => {
  const LAST_ROOM_NAME = sidebarMemoryKey("sidebar-last-room-name", "1:7");
  const PERSONAL_LOCAL = [
    LAST_ROOM_NAME,
    "messages_unread_count:schule:7",
    "student-search:last-filters:tenant-1:7",
    "moto:personal-storage-owner",
  ];
  const PERSONAL_SESSION = [
    "timetable-reopenable-instance",
    "parent-first-steps-opened:7",
  ];
  let leftAtSignOut: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    // The check runs when the cookie goes: nothing may outlive the session.
    mockSignOut.mockImplementation(() => {
      leftAtSignOut = [
        ...PERSONAL_LOCAL.filter((key) => localStorage.getItem(key) !== null),
        ...PERSONAL_SESSION.filter(
          (key) => sessionStorage.getItem(key) !== null,
        ),
      ];
      return Promise.resolve(undefined);
    });
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "7",
          tenantId: 1,
          name: "Mia Lehrerin",
          email: "mia@example.com",
          roles: [],
        },
      },
      status: "authenticated",
    });
    for (const key of PERSONAL_LOCAL) localStorage.setItem(key, "x");
    for (const key of PERSONAL_SESSION) sessionStorage.setItem(key, "x");
    localStorage.setItem("sidebar-collapsed", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["OGS", TeacherShellProvider],
    ["Betreiber", OperatorShellProvider],
    ["Schule", SchoolShellProvider],
    ["Caterer", CatererShellProvider],
    ["Eltern", ParentShellProvider],
  ] as const)("in the %s portal", async (_portal, Provider) => {
    leftAtSignOut = ["signOut was not called"];
    const { result } = renderHook(() => useShellAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider>{children}</Provider>
      ),
    });

    await result.current.logout();

    expect(leftAtSignOut).toEqual([]);
    // Device settings without data of a person stay.
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");
  });
});

// #5194: every portal's logout revokes its own refresh-token family on the
// server before Auth.js clears the cookie. A revocation the server refused
// still ends the session on this device and marks it for the login page
// (#7209).
describe("every portal logout revokes its session family (#5194)", () => {
  const portals = [
    ["OGS", TeacherShellProvider, "/api/auth/logout"],
    ["Betreiber", OperatorShellProvider, "/api/operator/auth/logout"],
    ["Schule", SchoolShellProvider, "/api/school/auth/logout"],
    ["Caterer", CatererShellProvider, "/api/caterer/auth/logout"],
    ["Eltern", ParentShellProvider, "/api/parent/auth/logout"],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "7", name: "User", email: "u@example.com", roles: [] },
      },
      status: "authenticated",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPortal(Provider: (typeof portals)[number][1]) {
    return renderHook(() => useShellAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider>{children}</Provider>
      ),
    });
  }

  it.each(portals)(
    "%s: revokes before the cookie goes",
    async (_portal, Provider, path) => {
      const order: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === path) order.push("revoke");
          return new Response(null, { status: 204 });
        }),
      );
      mockSignOut.mockImplementation(() => {
        order.push("signOut");
        return Promise.resolve(undefined);
      });

      await renderPortal(Provider).result.current.logout();

      expect(order).toEqual(["revoke", "signOut"]);
    },
  );

  it.each(portals)(
    "%s: a refused revocation still ends the session on this device",
    async (_portal, Provider, path) => {
      const order: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === path) order.push("revoke");
          return Response.json(
            {
              status: 503,
              detail: "logout could not revoke the session",
              code: "identity.logout_not_revoked",
            },
            { status: 503 },
          );
        }),
      );
      mockSignOut.mockImplementation(() => {
        order.push("signOut");
        return Promise.resolve(undefined);
      });

      await renderPortal(Provider).result.current.logout();

      expect(order).toEqual(["revoke", "signOut"]);
      expect(mockShowLogoutError).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBe("1");
      sessionStorage.removeItem(LOGOUT_NOT_REVOKED_KEY);
    },
  );

  it.each(portals)(
    "%s: a confirmed revocation leaves no marker of an earlier refusal",
    async (_portal, Provider) => {
      sessionStorage.setItem(LOGOUT_NOT_REVOKED_KEY, "1");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 204 })),
      );
      mockSignOut.mockResolvedValue(undefined);

      await renderPortal(Provider).result.current.logout();

      expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBeNull();
    },
  );
});

// Integration run #6187/#6188: a redirecting signOut resolves its
// callbackUrl against NEXTAUTH_URL, the tenant origin, so the parents and
// school logout landed on the tenant's host root instead of the portal's
// login.
describe("a hosted portal's logout opens its own login", () => {
  const portals = [
    ["Schule", SchoolShellProvider, "NEXT_PUBLIC_SCHOOL_HOSTNAME", "/school"],
    [
      "Caterer",
      CatererShellProvider,
      "NEXT_PUBLIC_CATERER_HOSTNAME",
      "/caterer",
    ],
    ["Eltern", ParentShellProvider, "NEXT_PUBLIC_PARENTS_HOSTNAME", "/parents"],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "7", name: "User", email: "u@example.com", roles: [] },
      },
      status: "authenticated",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(portals)(
    "%s: on the portal's host",
    async (_portal, Provider, hostEnv) => {
      vi.stubEnv(hostEnv, window.location.host);
      const { result } = renderHook(() => useShellAuth(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider>{children}</Provider>
        ),
      });

      await result.current.logout();

      expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
      expect(window.location.assign).toHaveBeenCalledWith("/login");
    },
  );

  it.each(portals)(
    "%s: on another host, through the portal's prefix",
    async (_portal, Provider, hostEnv, prefix) => {
      vi.stubEnv(hostEnv, "portal.example.test");
      const { result } = renderHook(() => useShellAuth(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider>{children}</Provider>
        ),
      });

      await result.current.logout();

      expect(window.location.assign).toHaveBeenCalledWith(`${prefix}/login`);
    },
  );
});

describe("endTraegerSession (#6955)", () => {
  const begin = vi.fn();
  const fail = vi.fn();

  beforeEach(() => {
    begin.mockReset().mockReturnValue({ fail });
    fail.mockReset();
    mockSignOut.mockReset().mockResolvedValue(undefined);
    mockClearSessionCache.mockReset();
    installSessionEndBarrier({
      beginSessionEnd: begin,
      fetchThroughSessionBarrier: (send, input, init) => send(input, init),
    });
    vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    localStorage.setItem("supervision-last-session", "Gruppe Sonne");
  });

  afterEach(() => {
    localStorage.removeItem("supervision-last-session");
  });

  it("revokes the session on the server, clears the account's data and holds late requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await endTraegerSession();

    expect(begin).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      portalAuthPath("traeger", "logout"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem("supervision-last-session")).toBeNull();
    expect(mockClearSessionCache).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
    expect(window.location.assign).toHaveBeenCalledWith(
      portalLoginPath("traeger"),
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it("ends the session and its data on this device when the server cannot revoke it (#7209)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: 500, code: "general.server", detail: "x" }),
        {
          status: 500,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    await endTraegerSession();

    expect(fail).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
    expect(localStorage.getItem("supervision-last-session")).toBeNull();
    expect(sessionStorage.getItem(LOGOUT_NOT_REVOKED_KEY)).toBe("1");
    sessionStorage.removeItem(LOGOUT_NOT_REVOKED_KEY);
  });

  it("keeps the session and its data when the logout route is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(endTraegerSession()).rejects.toThrow();

    expect(fail).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(localStorage.getItem("supervision-last-session")).toBe(
      "Gruppe Sonne",
    );
  });
});

describe("SchoolShellProvider names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <SchoolShellProvider>{children}</SchoolShellProvider>
  );

  it("shows the person's name", () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "Eva Ziel", email: "eva@schule.de" } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Eva Ziel");
    expect(result.current.profile).toEqual({
      firstName: "Eva",
      lastName: "Ziel",
    });
  });

  // Wie im Eltern-Portal: Die Adresse ist kein Name (#7305).
  it("never shows the sign-in address as the name", () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "eva@schule.de", email: "eva@schule.de" } },
      status: "authenticated",
    });

    const { result } = renderHook(() => useShellAuth(), { wrapper });

    expect(result.current.user?.name).toBe("Lehrkraft");
    expect(result.current.user?.email).toBe("eva@schule.de");
    expect(result.current.profile).toBeNull();
  });
});

describe("Operator and caterer names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Die Adresse ist auch hier kein Name (#7305).
  it.each([
    ["Operator", OperatorShellProvider],
    ["Caterer", CatererShellProvider],
  ] as const)(
    "%s never shows the sign-in address as the name",
    (fallback, Provider) => {
      mockUseSession.mockReturnValue({
        data: { user: { name: "ops@moto.de", email: "ops@moto.de" } },
        status: "authenticated",
      });

      const { result } = renderHook(() => useShellAuth(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider>{children}</Provider>
        ),
      });

      expect(result.current.user?.name).toBe(fallback);
      expect(result.current.user?.email).toBe("ops@moto.de");
    },
  );
});
