import { hasPermission } from "~/lib/auth-utils";
import { canReviewCareWithdrawals } from "~/lib/change-request-access";
import { mapCareWithdrawalPage } from "~/lib/care-exit-api";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { routes } from "~/lib/contract/students.generated";
import { mapPickupDataResponse } from "~/lib/pickup-schedule-helpers";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { mapArrivalData } from "~/lib/student-arrival-api";
import { mapPartialAbsence } from "~/lib/student-partial-absences-api";
import { mapStatusDays } from "~/lib/student-status-days-api";
import { studentKeys } from "~/lib/swr/portal-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import StudentDetailContent from "./page-content";
import { StudentRecordSeed } from "./page-seed";
import { getStatusDayRange } from "./status-day-range";

// The cached payload does not carry the audited record. Its existing
// session-scoped reader and all permission checks remain in charge.
export const unstable_dynamicStaleTime = 60;

async function loadStudentRecordSeed(slug: string, id: string) {
  const context = await readTenantPageContext(slug);
  if (!context || !isPositiveInt64Id(id)) return null;
  const window = getStatusDayRange();
  const builtAt = Date.now();
  const { snapshot, session, token } = context;
  const entries: ServerSeedEntry[] = [];
  const canRead = hasPermission(session, "users:read");
  const params = { id };
  // Never request the audited Kindakte from the seed. Each companion read
  // checks reach to this child in its own Go handler.
  if (canRead) {
    entries.push(
      {
        key: studentKeys.pickupData(id),
        value: seedRead("studentPickupData", async (signal) =>
          mapPickupDataResponse(
            (
              await readContract(
                routes["GET /api/students/{id}/pickup-schedules"],
                { token, signal, params },
              )
            ).data,
          ),
        ),
      },
      {
        key: studentKeys.arrivalData(id),
        value: seedRead("studentArrivalData", async (signal) =>
          mapArrivalData(
            (
              await readContract(
                routes["GET /api/students/{id}/arrival-schedules"],
                { token, signal, params },
              )
            ).data,
          ),
        ),
      },
      {
        key: studentKeys.partialAbsences(id, window.from, window.to),
        value: seedRead("studentPartialAbsences", async (signal) =>
          (
            await readContract(
              routes["GET /api/students/{id}/partial-absences"],
              { token, signal, params, query: window },
            )
          ).data.map(mapPartialAbsence),
        ),
      },
    );
  }
  if (
    canRead ||
    hasPermission(session, "users:update") ||
    hasPermission(session, "users:absence")
  ) {
    entries.push({
      key: studentKeys.statusDays(id, window.from, window.to),
      value: seedRead("studentStatusDays", async (signal) =>
        mapStatusDays(
          (
            await readContract(routes["GET /api/students/{id}/status-days"], {
              token,
              signal,
              params,
              query: window,
            })
          ).data,
        ),
      ),
    });
  }
  if (canReviewCareWithdrawals(session)) {
    entries.push({
      key: tenantStudentKeys.careWithdrawal(id),
      value: seedRead(
        "studentCareWithdrawal",
        async (signal) =>
          mapCareWithdrawalPage(
            (
              await readContract(routes["GET /api/students/care-withdrawals"], {
                token,
                signal,
                query: { student_id: id, page_size: 1 },
              })
            ).data,
          ).items[0] ?? null,
      ),
    });
  }
  return seedOf(snapshot, entries, builtAt);
}

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  // The URL parameters are needed by the authorized seed, not by the
  // reusable page shell. The mounted view reads the active URL itself.
  const seed = params
    .then(({ tenant, id }) => loadStudentRecordSeed(tenant, id))
    .catch(() => null);
  return (
    <StudentRecordSeed seed={seed}>
      <StudentDetailContent />
    </StudentRecordSeed>
  );
}
