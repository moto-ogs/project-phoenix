"use client";

import { useMemo, useSyncExternalStore } from "react";
import { RenderedBerlinDay } from "~/lib/hooks/use-berlin-today";
import type { ParentFamily } from "~/lib/parent-family-cards";
import {
  parentPageChildSeedKeys,
  parentPageSeedKeys,
  parentPageUsesChildren,
  parentShellSeedKeys,
  type ParentSeedPage,
} from "~/lib/parent-page-seed-keys";
import { parentKeys } from "~/lib/swr/parent-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

const subscribeNothing = () => () => {};

export function ParentServerSeed({
  day,
  seed,
  page,
  render = false,
  children,
}: Readonly<{
  day: string;
  seed: ServerSeedInput;
  page?: ParentSeedPage;
  /** A page: its server render waits for the seed's rendered entries. */
  render?: boolean;
  children: React.ReactNode;
}>) {
  const renderedDay = useSyncExternalStore(
    subscribeNothing,
    () => undefined,
    () => day,
  );
  const familyKey = parentKeys.familyStart(day);
  const claims = useMemo(
    () =>
      page
        ? [
            ...(parentPageUsesChildren(page) ? [familyKey] : []),
            ...parentPageSeedKeys(page, day),
          ]
        : [familyKey, ...parentShellSeedKeys],
    [page, day, familyKey],
  );
  const claimsFrom = useMemo(
    () =>
      page && parentPageUsesChildren(page)
        ? {
            key: familyKey,
            derive: (family: ParentFamily) =>
              parentPageChildSeedKeys(page, day, family.children),
          }
        : undefined,
    [page, day, familyKey],
  );
  return (
    <RenderedBerlinDay value={renderedDay}>
      <SWRServerSeed
        seed={seed}
        claims={claims}
        claimsFrom={claimsFrom}
        render={render}
      >
        {children}
      </SWRServerSeed>
    </RenderedBerlinDay>
  );
}
