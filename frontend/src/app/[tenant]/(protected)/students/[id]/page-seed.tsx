"use client";

import { useMemo, useState, type ReactNode } from "react";
import { studentKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { getStatusDayRange } from "./status-day-range";

export function StudentRecordSeed({
  id,
  seed,
  children,
}: Readonly<{ id: string; seed: ServerSeedInput; children: ReactNode }>) {
  const [{ from, to }] = useState(getStatusDayRange);
  const claims = useMemo(() => {
    return [
      studentKeys.pickupData(id),
      studentKeys.arrivalData(id),
      studentKeys.partialAbsences(id, from, to),
      studentKeys.statusDays(id, from, to),
      tenantStudentKeys.careWithdrawal(id),
    ];
  }, [id, from, to]);
  return (
    <SWRServerSeed seed={seed} claims={claims}>
      {children}
    </SWRServerSeed>
  );
}
