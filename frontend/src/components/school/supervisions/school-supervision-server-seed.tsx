"use client";

import type { ReactNode } from "react";
import {
  AUTO_VIEW,
  resolveSupervisionView,
} from "~/lib/school/supervision-view-model";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";

export function SchoolSupervisionServerSeed({
  seed,
  listKey,
  children,
}: Readonly<{ seed: ServerSeedInput; listKey: string; children: ReactNode }>) {
  return (
    <SWRServerSeed
      seed={seed}
      claims={[listKey]}
      claimsFrom={{
        key: listKey,
        derive: (instances: PlannedTimetableInstance[]) => {
          const view = resolveSupervisionView(
            AUTO_VIEW,
            [...instances].sort((a, b) =>
              a.startTime.localeCompare(b.startTime),
            ),
          );
          return view.mode === "detail"
            ? [schoolPortalKeys.supervisionRoster(view.instance.id)]
            : [];
        },
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
