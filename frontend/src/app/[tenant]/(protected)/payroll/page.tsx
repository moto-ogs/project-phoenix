import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/settings.generated";
import { hasPermission } from "~/lib/auth-utils";
import {
  mapPayrollDispatch,
  mapPayrollStatus,
  mapPayrollTargetCoverage,
} from "~/lib/payroll-api";
import { mapPayrollRules } from "~/lib/payroll-rules-api";
import { mapSFTPStatus } from "~/lib/sftp-export-api";
import { payrollKeys } from "~/lib/swr/portal-keys";
import * as staffContract from "~/lib/contract/staff.generated";
import PageContent from "./page-content";

export default async function PayrollPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="zeiterfassung"
      load={({ token, session }) => {
        if (!hasPermission(session, "config:manage")) return [];
        const status = seedRead(
          "GET /api/settings/payroll-status",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/settings/payroll-status"],
              { token, signal },
            );
            return mapPayrollStatus(data);
          },
        );
        return [
          { key: payrollKeys.status(), render: true, value: status },
          ...(hasPermission(session, "time_tracking:manage")
            ? [
                {
                  key: payrollKeys.sftpStatus(),
                  value: status.then((answer) =>
                    answer?.dispatch.channel === "sftp"
                      ? seedRead(
                          "GET /api/staff/time-tracking/export/sftp-status",
                          async (signal) => {
                            const { data } = await readContract(
                              staffContract.routes[
                                "GET /api/staff/time-tracking/export/sftp-status"
                              ],
                              { token, signal },
                            );
                            return mapSFTPStatus(data);
                          },
                        )
                      : undefined,
                  ),
                },
              ]
            : []),
          {
            key: payrollKeys.dispatch(),
            value: seedRead(
              "GET /api/staff/time-tracking/payroll-dispatch",
              async (signal) => {
                const { data } = await readContract(
                  staffContract.routes[
                    "GET /api/staff/time-tracking/payroll-dispatch"
                  ],
                  { token, signal },
                );
                return data.latest ? mapPayrollDispatch(data.latest) : null;
              },
            ),
          },
          {
            key: payrollKeys.rules(),
            value: seedRead(
              "GET /api/staff/time-tracking/payroll-rules",
              async (signal) => {
                const { data } = await readContract(
                  staffContract.routes[
                    "GET /api/staff/time-tracking/payroll-rules"
                  ],
                  { token, signal },
                );
                return mapPayrollRules(data);
              },
            ),
          },
          {
            key: payrollKeys.targetCoverage(),
            value: seedRead(
              "GET /api/staff/time-tracking/target-coverage",
              async (signal) => {
                const { data } = await readContract(
                  staffContract.routes[
                    "GET /api/staff/time-tracking/target-coverage"
                  ],
                  { token, signal },
                );
                return mapPayrollTargetCoverage(data);
              },
            ),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
