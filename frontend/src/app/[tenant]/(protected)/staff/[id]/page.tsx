import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/staff.generated";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { minimalProfile } from "~/lib/staff-api";
import { staffKeys } from "~/lib/swr/staff-keys";
import PageContent from "./page-content";

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        const admin = isAdmin(session) || hasPermission(session, "admin:*");
        const canViewTimeTracking =
          admin || hasPermission(session, "time_tracking:manage");
        const canViewStammdatenSections =
          canViewTimeTracking || hasPermission(session, "staff:stammdaten");
        const financial = hasPermission(session, "staff:financial");
        const documents =
          admin ||
          financial ||
          hasPermission(session, "staff:documents") ||
          hasPermission(session, "staff_documents:health");
        const limited =
          financial && !canViewStammdatenSections
            ? "financial"
            : documents &&
                !canViewTimeTracking &&
                !canViewStammdatenSections &&
                !financial
              ? "document"
              : null;
        const canViewRecord =
          canViewStammdatenSections ||
          hasPermission(session, "users:read") ||
          hasPermission(session, "staff:manage");
        const readRecord = () =>
          seedRead(
            "staff record",
            async (signal) =>
              (
                await readContract(contract.routes["GET /api/staff/{id}"], {
                  token,
                  signal,
                  params: { id },
                })
              ).data,
          );
        if (limited) {
          const profile = seedRead("staff identity", async (signal) => {
            const route =
              limited === "financial"
                ? contract.routes["GET /api/staff/financial-profile/{id}"]
                : contract.routes["GET /api/staff/documents-profile/{id}"];
            return minimalProfile(
              (await readContract(route, { token, signal, params: { id } }))
                .data,
              limited,
            );
          });
          return [
            { key: staffKeys.profileKey(id), render: true, value: profile },
            ...(canViewRecord
              ? [
                  {
                    key: staffKeys.recordKey(id),
                    value: profile.then((person) =>
                      person && !person.endedOn ? readRecord() : undefined,
                    ),
                  },
                ]
              : []),
          ];
        }
        return canViewRecord
          ? [
              {
                key: staffKeys.recordKey(id),
                render: true,
                value: readRecord(),
              },
            ]
          : [];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
