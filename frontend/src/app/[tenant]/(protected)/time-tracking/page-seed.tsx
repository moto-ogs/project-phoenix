"use client";

import type { ReactNode } from "react";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { ownTimeSeedKeys } from "./page-seed-keys";

export function TimeTrackingSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const { overview, period, leave } = ownTimeSeedKeys(useBerlinToday());
  return (
    <SWRServerSeed seed={seed} claims={[overview, period, leave]} render>
      {children}
    </SWRServerSeed>
  );
}
