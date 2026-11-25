import { TenantRouteSeed } from "../../../../tenant-route-seed";
import { mapPhaseOccupancyOffering } from "~/lib/care-offering-api";
import { mapCareOfferingBookingStats } from "~/lib/care-offering-booking-stats";
import { hasPermission } from "~/lib/auth-utils";
import { routes } from "~/lib/contract/enrollment.generated";
import * as studentContract from "~/lib/contract/students.generated";
import { requestSummaryFromContract } from "~/lib/enrollment-admin-api";
import {
  mapPhaseResponseOverview,
  phaseFromContract,
} from "~/lib/enrollment-phase-api";
import { careUsageReportFromContract } from "~/lib/enrollment-report-api";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import PageContent from "./page-content";

export default async function AdminEnrollmentPhasePage({
  params,
}: {
  params: Promise<{ tenant: string; phaseId: string }>;
}) {
  const { tenant, phaseId } = await params;
  const phaseQuery = { phase_id: phaseId };
  const filters = { ...phaseQuery, status: "all" as const };
  return (
    <TenantRouteSeed
      slug={tenant}
      module="online_anmeldung"
      load={({ token, session, tenant }) => {
        if (!hasPermission(session, "config:manage")) return [];
        const entries: ServerSeedEntry[] = [];
        if (hasPermission(session, "config:read")) {
          const phases = seedRead(
            "GET /api/enrollment/phases/",
            async (signal) => {
              const { data } = await readContract(
                routes["GET /api/enrollment/phases/"],
                { token, signal },
              );
              return data.map(phaseFromContract);
            },
          );
          const requests = seedRead(
            "GET /api/enrollment/admin/requests/",
            async (signal) => {
              const { data } = await readContract(
                routes["GET /api/enrollment/admin/requests/"],
                {
                  token,
                  signal,
                  query: phaseQuery,
                },
              );
              return data.map(requestSummaryFromContract);
            },
          );
          entries.push(
            { key: enrollmentKeys.phases(), render: true, value: phases },
            {
              key: enrollmentKeys.adminRequests(phaseId),
              render: true,
              value: requests,
            },
            {
              key: enrollmentKeys.phaseResponses(phaseId),
              value: seedRead(
                "GET /api/enrollment/phases/{id}/responses",
                async (signal) => {
                  const { data } = await readContract(
                    routes["GET /api/enrollment/phases/{id}/responses"],
                    {
                      token,
                      signal,
                      params: { id: phaseId },
                    },
                  );
                  return mapPhaseResponseOverview(data);
                },
              ),
            },
            {
              key: enrollmentKeys.careUsageReport(filters),
              render: true,
              value: seedRead(
                "GET /api/enrollment/admin/reports/care-usage",
                async (signal) => {
                  const { data } = await readContract(
                    routes["GET /api/enrollment/admin/reports/care-usage"],
                    {
                      token,
                      signal,
                      query: filters,
                    },
                  );
                  return careUsageReportFromContract(data);
                },
              ),
            },
          );
          if (tenant.careOfferingsEnabled !== false) {
            const showOccupancy = Promise.all([phases, requests]).then(
              ([values, requests]) =>
                requests !== undefined &&
                values?.some((phase) => phase.id === phaseId) === true,
            );
            entries.push(
              {
                key: enrollmentKeys.phaseOccupancyOfferings(phaseId),
                value: showOccupancy.then((show) =>
                  show
                    ? seedRead(
                        "GET /api/enrollment/care-offerings/",
                        async (signal) => {
                          const { data } = await readContract(
                            routes["GET /api/enrollment/care-offerings/"],
                            {
                              token,
                              signal,
                              query: phaseQuery,
                            },
                          );
                          return data.map(mapPhaseOccupancyOffering);
                        },
                      )
                    : undefined,
                ),
              },
              {
                key: enrollmentKeys.bookingStats(phaseId),
                value: showOccupancy.then((show) =>
                  show
                    ? seedRead(
                        "GET /api/enrollment/care-offerings/booking-stats",
                        async (signal) => {
                          const { data } = await readContract(
                            routes[
                              "GET /api/enrollment/care-offerings/booking-stats"
                            ],
                            {
                              token,
                              signal,
                              query: phaseQuery,
                            },
                          );
                          return mapCareOfferingBookingStats(data);
                        },
                      )
                    : undefined,
                ),
              },
            );
          }
        }
        if (
          hasPermission(session, "users:read") ||
          hasPermission(session, "students:read")
        ) {
          entries.push({
            key: enrollmentKeys.phaseSchoolClasses(),
            value: seedRead(
              "GET /api/students/school-classes",
              async (signal) =>
                (
                  await readContract(
                    studentContract.routes["GET /api/students/school-classes"],
                    { token, signal },
                  )
                ).data,
            ),
          });
        }
        return entries;
      }}
    >
      <PageContent params={params} />
    </TenantRouteSeed>
  );
}
