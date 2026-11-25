"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { dashboardKeys, ownSupervisionKeys } from "~/lib/swr/shell-keys";

export function ActiveSupervisionsSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const { data: session } = useSession();
  const accountId = session?.user.id;
  return (
    <SWRServerSeed
      seed={seed}
      claims={[
        accountId ? dashboardKeys.supervision(accountId) : null,
        ownSupervisionKeys.day(),
        ownSupervisionKeys.plannedNow(),
        ownSupervisionKeys.sessions(),
      ]}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
