"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useSession } from "next-auth/react";
import { sessionIdentityKey } from "~/lib/session-access";
import { fetchProfile } from "~/lib/profile-api";
import { createLogger } from "~/lib/logger";
import { useLatest } from "~/lib/hooks/use-latest";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { profileKeys } from "~/lib/swr/me-keys";
import type { Profile } from "~/lib/profile-helpers";

const logger = createLogger({ component: "ProfileContext" });

const REFRESH_MIN_GAP_MS = 5000;

interface ProfileContextType {
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  /**
   * Reads the profile again and rejects when the read fails (ADR 0311,
   * rule 6): for the profile edit after a refusal.
   */
  reloadProfile: () => Promise<Profile>;
  updateProfileData: (data: Profile) => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

function logProfileError(error: unknown) {
  // fetchProfile already reports the cause; a missing token is expected.
  logger.warn("failed to load profile", { error: String(error) });
}

/**
 * The signed-in user's profile from the shared SWR cache. The cache scope
 * follows the account and school, so a session change loads it again.
 */
export function ProfileProvider({
  children,
  initialProfile = null,
}: Readonly<{
  children: React.ReactNode;
  /** Server-preloaded profile from the tenant layout (#2973); skips the mount fetch. */
  initialProfile?: Profile | null;
}>) {
  const { data: session } = useSession();
  const sessionKey = sessionIdentityKey(session);
  // The server snapshot belongs to the identity it was rendered for.
  const [seedIdentity] = useState(sessionKey);
  const seed =
    initialProfile !== null &&
    sessionKey !== null &&
    sessionKey === seedIdentity
      ? initialProfile
      : undefined;

  const read = useSWRAuth<Profile>(
    sessionKey ? profileKeys.own() : null,
    fetchProfile,
    {
      fallbackData: seed,
      // A complete server snapshot is the mount load.
      revalidateIfStale: seed === undefined,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      onError: logProfileError,
    },
  );
  const { data, error, mutate } = read;
  const readRef = useLatest(read);
  const reloadProfile = useCallback(
    () => revalidateOrThrow(readRef.current),
    [readRef],
  );
  const profile = error === undefined ? (data ?? null) : null;
  const profileRef = useLatest(profile);

  const refreshingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  const refreshProfile = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < REFRESH_MIN_GAP_MS) return;
    if (refreshingRef.current) return;
    lastRefreshRef.current = now;
    refreshingRef.current = true;
    try {
      await mutate();
    } finally {
      refreshingRef.current = false;
    }
  }, [mutate]);

  // Optimistic local update after a save; the following refresh confirms it.
  const updateProfileData = useCallback(
    (saved: Profile) => {
      if (!profileRef.current) return;
      void mutate(saved, { revalidate: false });
    },
    [mutate, profileRef],
  );

  const contextValue = useMemo(
    () => ({
      profile,
      refreshProfile,
      reloadProfile,
      updateProfileData,
    }),
    [profile, refreshProfile, reloadProfile, updateProfileData],
  );

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
}

/**
 * Hook to access profile context
 * @throws Error if used outside ProfileProvider
 */
export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}
