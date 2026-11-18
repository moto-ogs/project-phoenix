"use client";

import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerProfile } from "~/lib/traeger-api";

/**
 * Who is signed in to which Träger: the account and the organization of the
 * session. The name belongs to the membership (#4693); the cache is scoped
 * to both, so a change of either drops the name read before.
 */
export type TraegerMembershipKey = `${string}:${string}`;

/**
 * The name of the signed-in person in this Träger-Büro, for the header
 * (#6870). It comes from the own profile, which every Träger role may read;
 * no account list is needed. `undefined` while it loads, after a failed read
 * and while the person has no name: the header then uses its neutral fallback.
 * The page „Konto“ reads and writes the same profile, so a saved name shows
 * here without signing in again. A failed read stays silent: the page
 * „Konto“ reports its own load error.
 */
export function useTraegerOwnName(membership: TraegerMembershipKey | null): {
  name: string | undefined;
} {
  const profile = useTraegerResource(
    membership ? traegerKeys.profile() : null,
    fetchTraegerProfile,
    "Dein Konto",
  ).data;
  return { name: profile?.name.trim() || undefined };
}
