import { staffDirectorySeed } from "~/lib/staff-directory-seed.server";
import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as staffContract from "~/lib/contract/staff.generated";
import { hasPermission } from "~/lib/auth-utils";
import { isAdmin } from "~/lib/auth-utils";
import { mapFormerStaff } from "~/lib/staff-api";
import { staffRecordKeys, traegerMonthStaffKeys } from "~/lib/swr/staff-keys";
import { berlinTodayISO } from "~/lib/date-helpers";
import { isScopeBooked } from "~/lib/module-register";
import { mapTimeAccountRow } from "~/lib/staff-overview-api";
import { mapMonthCloseSnapshotResponse } from "~/lib/time-tracking-helpers";
import { linkedMonth } from "./staff-month";
import PageContent from "./page-content";

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const query = await searchParams;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const status = Array.isArray(query.status) ? query.status[0] : query.status;
  const month = Array.isArray(query.month) ? query.month[0] : query.month;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        const canReadStaff =
          hasPermission(session, "users:read") ||
          hasPermission(session, "staff:manage") ||
          hasPermission(session, "staff:stammdaten");
        const canReadDocuments = [
          "staff:documents",
          "staff:financial",
          "staff_documents:health",
        ].some((permission) => hasPermission(session, permission));
        const canReadTimeAccounts =
          hasPermission(session, "time_tracking:manage") &&
          (view === "accounts" || !canReadStaff) &&
          isScopeBooked("zeiterfassung", school.bookedModules);
        const window = linkedMonth(month ?? null, berlinTodayISO());
        return [
          ...(canReadTimeAccounts
            ? [
                {
                  key: staffRecordKeys.timeAccounts(
                    window.year,
                    window.month,
                    "all",
                    undefined,
                    undefined,
                  ),
                  render: true,
                  value: seedRead("staff time accounts", async (signal) => {
                    const { data } = await readContract(
                      staffContract.routes[
                        "GET /api/staff/time-tracking/overview"
                      ],
                      { token, signal, query: window },
                    );
                    return {
                      year: data.year,
                      month: data.month,
                      rows: (data.rows ?? []).map(mapTimeAccountRow),
                    };
                  }),
                },
                {
                  key: staffRecordKeys.monthClose(window.year, window.month),
                  value: seedRead("staff month close", async (signal) =>
                    (
                      (
                        await readContract(
                          staffContract.routes[
                            "GET /api/staff/time-tracking/month-close"
                          ],
                          { token, signal, query: window },
                        )
                      ).data ?? []
                    ).map(mapMonthCloseSnapshotResponse),
                  ),
                },
                {
                  key: traegerMonthStaffKeys.month(window.year, window.month),
                  value: seedRead(
                    "staff month close responsibility",
                    async (signal) =>
                      (
                        await readContract(
                          staffContract.routes[
                            "GET /api/staff/time-tracking/month-close/traeger-staff"
                          ],
                          { token, signal, query: window },
                        )
                      ).data.staff_ids ?? [],
                  ),
                },
              ]
            : []),
          ...(canReadStaff
            ? [staffDirectorySeed(token, hasPermission(session, "groups:read"))]
            : []),
          ...(canReadStaff && view !== "accounts" && status === "ehemalige"
            ? [
                {
                  key: staffRecordKeys.former(),
                  render: true,
                  value: seedRead("GET /api/staff/former", async (signal) => {
                    const { data } = await readContract(
                      staffContract.routes["GET /api/staff/former"],
                      { token, signal },
                    );
                    return data
                      .map(mapFormerStaff)
                      .sort(
                        (a, b) =>
                          a.lastName.localeCompare(b.lastName, "de-DE") ||
                          a.firstName.localeCompare(b.firstName, "de-DE"),
                      );
                  }),
                },
              ]
            : []),
          ...(canReadDocuments &&
          !canReadStaff &&
          !isAdmin(session) &&
          !hasPermission(session, "time_tracking:manage")
            ? [
                {
                  key: staffRecordKeys.documentDirectory(),
                  render: true,
                  value: seedRead(
                    "GET /api/staff/documents-directory",
                    async (signal) => {
                      const { data } = await readContract(
                        staffContract.routes[
                          "GET /api/staff/documents-directory"
                        ],
                        { token, signal },
                      );
                      return data;
                    },
                  ),
                },
              ]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
