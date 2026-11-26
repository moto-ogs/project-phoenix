import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { hasPermission } from "~/lib/auth-utils";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { phaseFromContract } from "~/lib/enrollment-phase-api";
import {
  formSchemaFromContract,
  publicLegalTextsFromContract,
} from "~/lib/enrollment-form-schema-api";
import PageContent from "./page-content";

export default async function EnrollmentFormPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      module="online_anmeldung"
      load={({ token, session }) => {
        if (!hasPermission(session, "config:manage")) return [];
        return [
          {
            key: enrollmentKeys.phases(),
            render: true,
            value: seedRead("GET /api/enrollment/phases/", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/enrollment/phases/"],
                { token, signal },
              );
              return data.map(phaseFromContract);
            }),
          },
          {
            key: enrollmentKeys.publicLegalTexts(tenant),
            value: seedRead(
              "GET /api/enrollment/legal/{tenantSlug}",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/legal/{tenantSlug}"],
                  {
                    token: null,
                    signal,
                    params: { tenantSlug: tenant },
                  },
                );
                return publicLegalTextsFromContract(data);
              },
            ),
          },
          {
            key: enrollmentKeys.formSchemas(),
            render: true,
            value: seedRead(
              "GET /api/enrollment/schema/versions",
              async (signal) => {
                const { data } = await readContract(
                  routes["GET /api/enrollment/schema/versions"],
                  { token, signal },
                );
                return data.map(formSchemaFromContract);
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
