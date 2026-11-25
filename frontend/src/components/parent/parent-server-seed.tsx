"use client";

import { useMemo } from "react";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { parentKeys } from "~/lib/swr/parent-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

type ParentSeedDetail = "features" | "today";

const CLAIMS = [parentKeys.shellChildren()];

/**
 * The server seed of a parents shell or page (#8077). Claims the children
 * list and, once the list is known in the browser, the detail collections
 * the page reads: their readers wait for the server's values instead of
 * loading the same data again.
 */
export function ParentServerSeed({
  seed,
  details,
  render = false,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  details: readonly ParentSeedDetail[];
  /** A page: its server render waits for the seed's rendered entries. */
  render?: boolean;
  children: React.ReactNode;
}>) {
  const day = useBerlinToday();
  // On a client navigation the cache already holds the list: the detail keys
  // of its relationships are known at once and wait for the seed too.
  const claimsFrom = useMemo(
    () => ({
      key: parentKeys.shellChildren(),
      derive: (linked: readonly parentMeContract.ChildResponse[]) =>
        details.map((detail) => parentKeys[detail](linked, day)),
    }),
    [details, day],
  );
  return (
    <SWRServerSeed
      seed={seed}
      claims={CLAIMS}
      claimsFrom={claimsFrom}
      render={render}
    >
      {children}
    </SWRServerSeed>
  );
}
