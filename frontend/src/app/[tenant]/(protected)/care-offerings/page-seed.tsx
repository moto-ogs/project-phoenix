"use client";

import type { ReactNode } from "react";
import { initialOfferingPhaseId, type Phase } from "~/lib/enrollment-phase-api";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { databaseKeys } from "~/lib/swr/portal-keys";
import {
  SWRServerSeed,
  type ServerSeedClaimsFrom,
  type ServerSeedInput,
} from "~/lib/swr/server-seed";

const claims = [
  enrollmentKeys.phases(),
  databaseKeys.calendarPeriods(),
  enrollmentKeys.offeringTemplates(),
];
const phaseClaims: ServerSeedClaimsFrom<Phase[]> = {
  key: enrollmentKeys.phases(),
  derive: (phases) => {
    const id = initialOfferingPhaseId(phases);
    return id
      ? [enrollmentKeys.careOfferings(id), enrollmentKeys.bookingStats(id)]
      : [];
  },
};

export function CareOfferingsSeed({
  seed,
  children,
}: {
  seed: ServerSeedInput;
  children: ReactNode;
}) {
  return (
    <SWRServerSeed seed={seed} claims={claims} claimsFrom={phaseClaims} render>
      {children}
    </SWRServerSeed>
  );
}
