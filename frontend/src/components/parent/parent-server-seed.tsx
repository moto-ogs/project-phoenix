"use client";

import { useMemo } from "react";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import {
  parentPageChildSeedKeys,
  parentPageSeedKeys,
  parentPageUsesChildren,
  parentShellSeedKeys,
  type ParentSeedPage,
} from "~/lib/parent-page-seed-keys";
import { parentKeys } from "~/lib/swr/parent-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

type ParentSeedDetail = "features" | "today";

/**
 * The server seed of a parents shell or page (#8077). Claims the children
 * list and, once the list is known in the browser, the detail collections
 * the page reads: their readers wait for the server's values instead of
 * loading the same data again.
 */
export function ParentServerSeed({
  seed,
  details,
  page,
  render = false,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  details: readonly ParentSeedDetail[];
  /** Absent for the shell. */
  page?: ParentSeedPage;
  /** A page: its server render waits for the seed's rendered entries. */
  render?: boolean;
  children: React.ReactNode;
}>) {
  const day = useBerlinToday();
  const claims = useMemo(
    () =>
      page
        ? [
            ...(parentPageUsesChildren(page)
              ? [parentKeys.shellChildren()]
              : []),
            ...parentPageSeedKeys(page, day),
          ]
        : parentShellSeedKeys,
    [page, day],
  );
  // On a client navigation the cache already holds the list: the detail keys
  // of its relationships are known at once and wait for the seed too.
  const claimsFrom = useMemo(
    () => ({
      key: parentKeys.shellChildren(),
      derive: (linked: readonly parentMeContract.ChildResponse[]) => [
        ...details.map((detail) => parentKeys[detail](linked, day)),
        ...(page ? parentPageChildSeedKeys(page, day, linked) : []),
      ],
    }),
    [details, day, page],
  );
  return (
    <SWRServerSeed
      seed={seed}
      claims={claims}
      claimsFrom={
        !page || parentPageUsesChildren(page) ? claimsFrom : undefined
      }
      render={render}
    >
      {children}
    </SWRServerSeed>
  );
}
