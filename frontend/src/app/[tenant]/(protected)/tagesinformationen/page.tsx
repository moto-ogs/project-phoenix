import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/staff-notices.generated";
import { hasEffectiveAdminScope, hasPermission } from "~/lib/auth-utils";
import { toStaffNotice } from "~/lib/staff-notices-api";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";
import PageContent from "./page-content";

export default async function TagesinformationenPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ hinweis?: string | string[] }>;
}) {
  const { tenant } = await params;
  const { hinweis } = await searchParams;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        // Today's notices are already seeded by the shell for its badge.
        const accountId = session.user.id;
        const linkedId = Array.isArray(hinweis) ? hinweis[0] : hinweis;
        return [
          ...(hasEffectiveAdminScope(session) &&
          hasPermission(session, "admin:*")
            ? [
                {
                  key: staffNoticeKeys.all(accountId),
                  render: true,
                  value: seedRead("GET /api/staff-notices/", async (signal) => {
                    const { data } = await readContract(
                      routes["GET /api/staff-notices/"],
                      { token, signal },
                    );
                    return data.map(toStaffNotice);
                  }),
                },
              ]
            : []),
          ...(linkedId && hasPermission(session, "users:read")
            ? [
                {
                  key: staffNoticeKeys.linked(accountId, linkedId),
                  render: true,
                  value: seedRead(
                    "GET /api/staff-notices/{noticeId}",
                    async (signal) => {
                      const { data } = await readContract(
                        routes["GET /api/staff-notices/{noticeId}"],
                        { token, signal, params: { noticeId: linkedId } },
                      );
                      return toStaffNotice(data);
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
