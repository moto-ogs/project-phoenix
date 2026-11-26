"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import type { AbsenceType } from "~/lib/absence-type-api";
import { useBookedModules } from "~/lib/tenant-context";
import {
  SWRServerSeed,
  type ServerSeedClaimsFrom,
  type ServerSeedInput,
} from "~/lib/swr/server-seed";
import { staffAbsenceKeys, staffKeys } from "~/lib/swr/staff-keys";
import {
  staffAllowancesKey,
  staffAllowanceTypes,
  staffOverviewReads,
  staffTabOpening,
  type StaffDetailOpening,
} from "./staff-detail-seed-keys";
import { staffDetailAccess } from "./staff-detail-tabs";

type ClaimSource = { accountStartDate: string } | AbsenceType[];

export function StaffDetailSeed({
  seed,
  opening,
  children,
}: {
  seed: ServerSeedInput;
  opening: StaffDetailOpening;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const access = staffDetailAccess(session, useBookedModules());
  const { id, today } = opening;
  const tab = staffTabOpening(opening, access);
  const claims = [
    access.limitedProfile ? staffKeys.profileKey(id) : null,
    access.viewRecord ? staffKeys.recordKey(id) : null,
    access.manageAbsences ? staffAbsenceKeys.pendingForStaff(id) : null,
    ...tab.claims,
  ];
  // On a warm navigation the browser can know these keys before the new
  // request's config or type list streams in. Claim its cached variant too.
  let claimsFrom: ServerSeedClaimsFrom<ClaimSource> | undefined;
  if (tab.tab === "uebersicht") {
    claimsFrom = {
      key: tab.configKey,
      derive: (data) => {
        if (Array.isArray(data)) return [];
        const { history, absences, adjustments, targets } = staffOverviewReads(
          id,
          today,
          data.accountStartDate,
        );
        return [history, absences, adjustments, targets];
      },
    };
  } else if (tab.tab === "abwesenheiten") {
    const { year, keys } = tab;
    claimsFrom = {
      key: keys.types,
      derive: (data) =>
        Array.isArray(data)
          ? [staffAllowancesKey(id, year, staffAllowanceTypes(data))]
          : [],
    };
  }
  return (
    <SWRServerSeed seed={seed} claims={claims} claimsFrom={claimsFrom} render>
      {children}
    </SWRServerSeed>
  );
}
