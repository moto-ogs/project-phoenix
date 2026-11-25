import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/display.generated";
import { hasPermission } from "~/lib/auth-utils";
import { mapDisplayResponse } from "~/lib/display-helpers";
import { displayKeys } from "~/lib/swr/portal-keys";
import PageContent from "./page-content";

export default async function InfoDisplaysPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (
          !school.displayEnabled ||
          (!hasPermission(session, "display:read") &&
            !hasPermission(session, "display:manage"))
        )
          return [];
        return [
          {
            key: displayKeys.list(),
            render: true,
            value: seedRead("GET /api/display/", async (signal) => {
              const { data } = await readContract(routes["GET /api/display/"], {
                token,
                signal,
              });
              return data.map(mapDisplayResponse);
            }),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
