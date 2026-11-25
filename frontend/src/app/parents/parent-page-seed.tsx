import type { ReactNode } from "react";
import { ParentServerSeed } from "~/components/parent/parent-server-seed";
import type { ParentSeedPage } from "~/lib/parent-page-seed-keys";
import { loadParentPageSeed } from "~/lib/parent-seed.server";

const FAMILY_DETAILS = ["features", "today"] as const;
const FEATURES = ["features"] as const;
const NO_DETAILS = [] as const;

/** A first-display seed, under the route's existing loading boundary. */
export function ParentPageSeed({
  page,
  children,
}: Readonly<{ page: ParentSeedPage; children: ReactNode }>) {
  const seed = loadParentPageSeed(page).catch(() => null);
  const details =
    page.kind === "start" ||
    page.kind === "child" ||
    page.kind === "children" ||
    page.kind === "conversation"
      ? FAMILY_DETAILS
      : page.kind === "conference" ||
          page.kind === "meal" ||
          page.kind === "groupThread"
        ? FEATURES
        : NO_DETAILS;
  // Don't hold a conversation opening on the optional composer seed:
  // the existing reader has to mark the opened thread read.
  const render = page.kind !== "conversation" && page.kind !== "groupThread";
  return (
    <ParentServerSeed seed={seed} details={details} page={page} render={render}>
      {children}
    </ParentServerSeed>
  );
}
