"use client";

import { useMemo } from "react";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { parentKeys } from "~/lib/swr/parent-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

export function ParentServerSeed({
  seed,
  render = false,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  /** A page: its server render waits for the seed's rendered entries. */
  render?: boolean;
  children: React.ReactNode;
}>) {
  const day = useBerlinToday();
  const claims = useMemo(() => [parentKeys.familyStart(day)], [day]);
  return (
    <SWRServerSeed seed={seed} claims={claims} render={render}>
      {children}
    </SWRServerSeed>
  );
}
