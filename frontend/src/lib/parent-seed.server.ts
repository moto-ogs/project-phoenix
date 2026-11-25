import { headers } from "next/headers";
import { cache } from "react";
import * as parentMeContract from "~/lib/contract/parent-me.generated";
import { applyCards, familyCards } from "~/lib/parent-family-cards";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  readPortalSessionSnapshot,
  type PortalSessionSnapshot,
} from "~/lib/portal-session-snapshot.server";
import {
  PARENT_PUBLIC_PAGES,
  isPortalPublicPath,
} from "~/lib/portal-public-pages";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { parentKeys } from "~/lib/swr/parent-keys";
import type { ServerSeed } from "~/lib/swr/server-seed";

// Layout and page share this one authorized read within a server render.
const loadFamily = cache((token: string) =>
  seedRead("parentFamilyStart", async (signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/family-start"],
      { token, signal },
    );
    return applyCards(undefined, familyCards(response.data));
  }),
);

/** A parent snapshot that may carry personal data, else null. */
async function parentSnapshot(): Promise<PortalSessionSnapshot | null> {
  const snapshot = await readPortalSessionSnapshot("parent");
  if (
    !snapshot ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "parent"
  ) {
    return null;
  }
  return snapshot;
}

/**
 * The page the browser asked for, as the proxy recorded it (it overwrites
 * any value the client sent), without the query.
 */
export async function parentRequestPath(): Promise<string | null> {
  const original = (await headers()).get("x-moto-original-path");
  if (!original) return null;
  return original.split("?")[0] ?? null;
}

/** Whether the shell may carry personal data on this path. */
export function isProtectedParentPath(path: string | null): path is string {
  return (
    path !== null && !isPortalPublicPath("parent", PARENT_PUBLIC_PAGES, path)
  );
}

/** The URL never supplies child IDs to the seed. */
export async function loadParentSeed(
  render: boolean,
): Promise<ServerSeed | null> {
  const builtAt = Date.now();
  const snapshot = await parentSnapshot();
  if (!snapshot) return null;
  return seedOf(
    snapshot,
    [
      {
        key: parentKeys.familyStart(berlinTodayISO()),
        value: loadFamily(snapshot.accessToken),
        render,
      },
    ],
    builtAt,
  );
}
