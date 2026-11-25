"use client";

import { useMemo, useSyncExternalStore } from "react";
import { RenderedBerlinDay } from "~/lib/hooks/use-berlin-today";
import { parentKeys } from "~/lib/swr/parent-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

const subscribeNothing = () => () => {};

export function ParentServerSeed({
  day,
  seed,
  render = false,
  children,
}: Readonly<{
  day: string;
  seed: ServerSeedInput;
  /** A page: its server render waits for the seed's rendered entries. */
  render?: boolean;
  children: React.ReactNode;
}>) {
  const renderedDay = useSyncExternalStore(
    subscribeNothing,
    () => undefined,
    () => day,
  );
  const claims = useMemo(() => [parentKeys.familyStart(day)], [day]);
  return (
    <RenderedBerlinDay value={renderedDay}>
      <SWRServerSeed seed={seed} claims={claims} render={render}>
        {children}
      </SWRServerSeed>
    </RenderedBerlinDay>
  );
}
