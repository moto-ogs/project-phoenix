import { describe, it, expect, vi, beforeEach } from "vitest";
import { releaseFakeTimers } from "~/test/clock";
import { renderHook, act } from "@testing-library/react";
import { waitFor } from "~/test/wait-for-state";
import type { ReactNode } from "react";
import { ProfileProvider, useProfile } from "./profile-context";
import type { Profile } from "./profile-helpers";
import * as profileApi from "./profile-api";
import * as nextAuthReact from "next-auth/react";
import { mockSessionData } from "~/test/mocks/next-auth";
import { SWRConfig } from "~/lib/swr/testing";
import { SWRScopeBoundary } from "~/lib/swr";

vi.unmock("swr");
// Mock the API module
vi.mock("./profile-api");
vi.mock("next-auth/react");

let cache = new Map();

// The tenant shell around the provider: a fresh SWR cache and the scope
// boundary that drops it at every session boundary, as in providers.tsx.
function Shell({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => cache }}>
      <SWRScopeBoundary />
      {children}
    </SWRConfig>
  );
}

describe("ProfileContext", () => {
  const mockProfile: Profile = {
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    avatar: "/api/me/profile/avatar/avatar.jpg",
    version: "p1",
  };

  const mockSession = mockSessionData({
    user: {
      email: "john.doe@example.com",
    },
    expires: "2025-01-01T00:00:00Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Map();

    // Default mock implementations
    vi.mocked(nextAuthReact.useSession).mockReturnValue({
      data: mockSession,
      status: "authenticated",
      update: vi.fn(),
    });

    // Every answer is a new object, as from the network.
    vi.mocked(profileApi.fetchProfile).mockImplementation(async () =>
      structuredClone(mockProfile),
    );
  });

  describe("ProfileProvider", () => {
    it("should fetch profile on mount when session exists", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      expect(result.current.profile).toEqual(mockProfile);
    });

    it("renders a server-preloaded profile without fetching (#2973)", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider initialProfile={mockProfile}>
            {children}
          </ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      expect(result.current.profile).toEqual(mockProfile);
      await act(async () => {
        await Promise.resolve();
      });
      expect(profileApi.fetchProfile).not.toHaveBeenCalled();
    });

    it("should not fetch profile when no session token", async () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await act(async () => {
        await Promise.resolve();
      });

      expect(profileApi.fetchProfile).not.toHaveBeenCalled();
      expect(result.current.profile).toBe(null);
    });

    it("should handle fetch errors gracefully", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      vi.mocked(profileApi.fetchProfile).mockRejectedValue(
        new Error("Network error"),
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      // fetchProfile reports the cause itself; this is only a breadcrumb.
      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith("failed to load profile", {
          error: expect.any(String),
        });
      });
      expect(result.current.profile).toBe(null);

      consoleWarnSpy.mockRestore();
    });

    // The browser session carries no token (#5005): a poll that only
    // prolongs the session leaves the identity and the profile untouched.
    it("keeps the profile when a session poll only prolongs the session", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result, rerender } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
        expect(result.current.profile).toEqual(mockProfile);
      });

      const newSession = {
        ...mockSession,
        expires: "2025-01-02T00:00:00Z",
      };

      // Update the mock before rerendering
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: newSession,
        status: "authenticated",
        update: vi.fn(),
      });

      rerender();
      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      expect(result.current.profile).toEqual(mockProfile);
    });

    it("should clear profile when session is removed", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { rerender, result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      // Remove session - update mock before rerender
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      rerender();

      await waitFor(() => {
        expect(result.current.profile).toBe(null);
      });
    });
  });

  describe("refreshProfile", () => {
    it("should refresh profile manually", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();

      // Use fake timers for debounce testing
      vi.useFakeTimers();

      // Advance time to bypass debounce (5 seconds minimum)
      vi.advanceTimersByTime(6000);

      await act(async () => {
        await result.current.refreshProfile();
      });

      releaseFakeTimers();

      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
    });

    it("should debounce rapid refresh calls (< 5 seconds)", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();
      vi.useFakeTimers();

      // First refresh - advance time to pass debounce
      vi.advanceTimersByTime(6000);
      await act(async () => {
        await result.current.refreshProfile();
      });

      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();

      // Second refresh immediately (within 5 seconds) - should be ignored
      await act(async () => {
        await result.current.refreshProfile();
      });

      releaseFakeTimers();

      expect(profileApi.fetchProfile).not.toHaveBeenCalled();
    });

    it("should allow refresh after 5 seconds", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();
      vi.useFakeTimers();

      // First refresh
      vi.advanceTimersByTime(6000);
      await act(async () => {
        await result.current.refreshProfile();
      });

      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();

      // Wait 5 seconds and refresh again
      vi.advanceTimersByTime(5000);
      await act(async () => {
        await result.current.refreshProfile();
      });

      releaseFakeTimers();

      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
    });

    it("should prevent concurrent refreshes", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();
      vi.useFakeTimers();
      vi.advanceTimersByTime(6000);

      // Make fetch profile slow to test concurrent calls
      let resolveFirstFetch: () => void = () => undefined;
      const firstFetchPromise = new Promise<Profile>((resolve) => {
        resolveFirstFetch = () => resolve(mockProfile);
      });

      vi.mocked(profileApi.fetchProfile).mockReturnValue(firstFetchPromise);

      // Start first refresh
      act(() => {
        void result.current.refreshProfile();
      });

      // Try to start second refresh while first is still running
      act(() => {
        void result.current.refreshProfile();
      });

      // Complete the first fetch
      act(() => {
        resolveFirstFetch();
      });

      releaseFakeTimers();

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      // Should only have called fetchProfile once
      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateProfileData", () => {
    it("should update profile data optimistically", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      act(() => {
        result.current.updateProfileData({
          ...mockProfile,
          firstName: "Jane",
          version: "p2",
        });
      });

      expect(result.current.profile).toEqual({
        ...mockProfile,
        firstName: "Jane",
        version: "p2",
      });
    });

    it("should not update when profile is null", async () => {
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.updateProfileData({ ...mockProfile, firstName: "Jane" });
      });

      expect(result.current.profile).toBe(null);
    });
  });

  describe("data change detection", () => {
    it("should not trigger re-render when fetched data is identical", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      const firstProfile = result.current.profile;

      vi.clearAllMocks();
      vi.useFakeTimers();
      vi.advanceTimersByTime(6000);

      // Fetch same data again
      vi.mocked(profileApi.fetchProfile).mockResolvedValue(mockProfile);

      await act(async () => {
        await result.current.refreshProfile();
      });

      releaseFakeTimers();

      await waitFor(() => {
        expect(profileApi.fetchProfile).toHaveBeenCalled();
      });

      // Profile object should be the same reference (no re-render)
      expect(result.current.profile).toBe(firstProfile);
    });

    it("should update when profile data changes", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();
      vi.useFakeTimers();
      vi.advanceTimersByTime(6000);

      const updatedProfile = { ...mockProfile, firstName: "Jane" };
      vi.mocked(profileApi.fetchProfile).mockResolvedValue(updatedProfile);

      await act(async () => {
        await result.current.refreshProfile();
      });

      releaseFakeTimers();

      await waitFor(() => {
        expect(result.current.profile?.firstName).toBe("Jane");
      });
    });
  });

  describe("profile scope changes", () => {
    it("loads a new profile after switching schools", async () => {
      const sessionWithTenant = {
        ...mockSession,
        user: { ...mockSession.user, tenantId: "1" },
      };

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: sessionWithTenant,
        status: "authenticated",
        update: vi.fn(),
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result, rerender } = renderHook(() => useProfile(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      // First refresh happened on mount
      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();

      // Switch tenant
      const newSession = {
        ...mockSession,
        user: {
          ...mockSession.user,
          tenantId: "2",
        },
      };

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: newSession,
        status: "authenticated",
        update: vi.fn(),
      });

      rerender();

      // The school change triggers a new fetch
      await waitFor(() => {
        expect(profileApi.fetchProfile).toHaveBeenCalled();
      });
    });

    it("loads the new session when tenantId becomes undefined", async () => {
      const sessionWithTenant = {
        ...mockSession,
        user: { ...mockSession.user, tenantId: "1" },
      };

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: sessionWithTenant,
        status: "authenticated",
        update: vi.fn(),
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result, rerender } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      vi.clearAllMocks();

      // Session becomes undefined tenantId (e.g. during logout transition)
      const noTenantSession = {
        ...mockSession,
        user: { ...mockSession.user, tenantId: undefined },
      };

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: noTenantSession,
        status: "authenticated",
        update: vi.fn(),
      });

      rerender();

      // A new session generation drops the old answer (#5006); the profile
      // loads again for the new session instead of carrying the old one.
      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });
      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
    });

    it("loads a profile on re-login to the same school", async () => {
      const sessionWithTenant = {
        ...mockSession,
        user: { ...mockSession.user, tenantId: "1" },
      };

      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: sessionWithTenant,
        status: "authenticated",
        update: vi.fn(),
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result, rerender } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => {
        expect(result.current.profile).toEqual(mockProfile);
      });

      // Initial fetch
      expect(profileApi.fetchProfile).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();

      // Logout: tenantId becomes undefined
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          ...mockSession,
          user: { ...mockSession.user, tenantId: undefined },
        },
        status: "authenticated",
        update: vi.fn(),
      });

      rerender();

      // Re-login to same tenant (tenantId back to 1)
      vi.mocked(nextAuthReact.useSession).mockReturnValue({
        data: {
          ...mockSession,
          user: {
            ...mockSession.user,
            tenantId: "1",
          },
        },
        status: "authenticated",
        update: vi.fn(),
      });

      rerender();

      // The changed session scope loads a fresh profile.
      await waitFor(() => {
        expect(profileApi.fetchProfile).toHaveBeenCalled();
      });
    });
  });

  // ADR 0311 rule 6: a refused profile edit shows the stored profile only
  // once a read succeeded; a failed read rejects instead of answering the
  // shown profile.
  describe("reloadProfile", () => {
    it("reads the profile again and rejects when the read fails", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );
      const { result } = renderHook(() => useProfile(), { wrapper });
      await waitFor(() => expect(result.current.profile).toEqual(mockProfile));

      const stored = { ...mockProfile, firstName: "Johanna", version: "p2" };
      vi.mocked(profileApi.fetchProfile).mockResolvedValueOnce(stored);
      await act(async () => {
        await expect(result.current.reloadProfile()).resolves.toEqual(stored);
      });
      expect(result.current.profile).toEqual(stored);

      vi.mocked(profileApi.fetchProfile).mockRejectedValueOnce(
        new Error("offline"),
      );
      await act(async () => {
        await expect(result.current.reloadProfile()).rejects.toThrow("offline");
      });
    });
  });

  describe("useProfile hook", () => {
    it("should throw error when used outside ProfileProvider", () => {
      // Suppress console.error for this test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      expect(() => {
        renderHook(() => useProfile());
      }).toThrow("useProfile must be used within a ProfileProvider");

      consoleErrorSpy.mockRestore();
    });

    it("should return context value when used within provider", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Shell>
          <ProfileProvider>{children}</ProfileProvider>
        </Shell>
      );

      const { result } = renderHook(() => useProfile(), { wrapper });

      expect(result.current).toHaveProperty("profile");
      expect(result.current).toHaveProperty("refreshProfile");
      expect(result.current).toHaveProperty("updateProfileData");

      expect(typeof result.current.refreshProfile).toBe("function");
      expect(typeof result.current.updateProfileData).toBe("function");
    });
  });
});
