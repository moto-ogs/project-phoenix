import { TenantRouteSeed } from "../../tenant-route-seed";
import { seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/students.generated";
import { contractGet } from "~/lib/contract/client.server";
import { canReadStudents } from "~/lib/student-access";
import { mapStudentListRow } from "~/lib/student-wire";
import { roomKeys } from "~/lib/swr/rooms-keys";
import {
  CHILD_OVERVIEW_PATH,
  transitDayStatusFromReferrer,
  transitReferrer,
} from "./transit-selection";
import PageContent from "./page-content";

export default async function TransitPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const query = await searchParams;
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (school.presenceMode === "binary" || !canReadStudents(session))
          return [];
        const referrer = transitReferrer(from ?? null);
        const dayStatus = referrer.startsWith(CHILD_OVERVIEW_PATH)
          ? transitDayStatusFromReferrer(referrer)
          : undefined;
        return [
          {
            key: roomKeys.transitStudents(dayStatus),
            render: true,
            value: seedRead("transit students", async (signal) => {
              const read = await contractGet(
                contract.routes["GET /api/students/"],
                {
                  token,
                  signal,
                  query: {
                    location_state: "transit",
                    day_status: dayStatus,
                    page_size: 200,
                    view: "slim",
                  },
                },
              );
              if (!read.ok) throw read.error.cause;
              return {
                students: read.value.data.map((row) =>
                  mapStudentListRow(row, "slim"),
                ),
                pagination: read.value.pagination,
              };
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
