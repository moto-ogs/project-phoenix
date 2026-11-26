import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/rooms.generated";
import { hasPermission } from "~/lib/auth-utils";
import { mapRoomsResponse } from "~/lib/room-helpers";
import { roomKeys } from "~/lib/swr/rooms-keys";
import * as activeContract from "~/lib/contract/active.generated";
import { mapDashboardAnalyticsResponse } from "~/lib/dashboard-helpers";
import { dashboardKeys } from "~/lib/swr/shell-keys";
import PageContent from "./page-content";

export default async function RoomsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (school.presenceMode === "binary") return [];
        return [
          ...(hasPermission(session, "rooms:read")
            ? [
                {
                  key: roomKeys.key({ includeSystem: true }),
                  render: true,
                  value: seedRead("GET /api/rooms/", async (signal) => {
                    const { data } = await readContract(
                      routes["GET /api/rooms/"],
                      { token, signal, query: { include_system: true } },
                    );
                    return mapRoomsResponse(data);
                  }),
                },
              ]
            : []),
          ...(hasPermission(session, "groups:read")
            ? [
                {
                  key: dashboardKeys.analytics(),
                  value: seedRead(
                    "GET /api/active/analytics/dashboard",
                    async (signal) => {
                      const { data } = await readContract(
                        activeContract.routes[
                          "GET /api/active/analytics/dashboard"
                        ],
                        { token, signal },
                      );
                      return mapDashboardAnalyticsResponse(data);
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
