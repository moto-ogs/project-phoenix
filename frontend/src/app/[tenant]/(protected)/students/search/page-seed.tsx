"use client";

import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { hasPermission } from "~/lib/auth-utils";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useStudentPhotosEnabled } from "~/lib/hooks/use-student-photos-enabled";
import { initialStudentSearch } from "~/lib/student-search-url";
import { groupKeys } from "~/lib/swr/groups-keys";
import { studentKeys } from "~/lib/swr/portal-keys";
import { roomKeys } from "~/lib/swr/rooms-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";

export function StudentSearchSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const query = useSearchParams();
  const { enabled } = useStudentPhotosEnabled();
  const { data: session } = useSession();
  const initial = initialStudentSearch(query, berlinTodayISO(), enabled);
  const answer = query.get("enrollment_answer");
  const claims = [
    studentKeys.search(initial),
    answer
      ? studentKeys.search({ ...initial, enrollmentAnswer: answer })
      : null,
    studentKeys.schoolClasses(),
    hasPermission(session, "users:read")
      ? tenantListKeys.enrollmentAnswerFilters(initial.date)
      : null,
    hasPermission(session, "groups:read") ? groupKeys.key() : null,
    hasPermission(session, "rooms:read")
      ? roomKeys.key({ page: 1, pageSize: 1000 })
      : null,
  ];
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      {children}
    </SWRServerSeed>
  );
}
