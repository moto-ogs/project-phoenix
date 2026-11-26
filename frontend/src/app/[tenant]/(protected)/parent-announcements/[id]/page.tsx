import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/parent-announcements.generated";
import * as groups from "~/lib/contract/groups.generated";
import * as activities from "~/lib/contract/activities.generated";
import { hasPermission } from "~/lib/auth-utils";
import { hasLetterPlaceholders } from "~/lib/parent-letter-placeholders";
import {
  isDeclaration,
  isLetter,
  isPoll,
  mapAnnouncementRecipients,
  mapDeclarationStatus,
  mapLetterStatus,
  mapPollChildren,
  mapPollResults,
  showAnnouncementReadStats,
  toAnnouncement,
} from "~/lib/parent-announcements-api";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import PageContent from "./page-content";

export default async function ParentAnnouncementsPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  const routeParams = { announcementId: id };
  return (
    <TenantRouteSeed
      slug={tenant}
      module="eltern_app"
      load={({ token, session }) => {
        if (!hasPermission(session, "admin:*")) return [];
        const announcement = seedRead(
          "GET /api/parent-announcements/{announcementId}",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/parent-announcements/{announcementId}"],
              {
                token,
                signal,
                params: routeParams,
              },
            );
            return toAnnouncement(data);
          },
        );
        return [
          {
            key: parentAnnouncementKeys.detail(id),
            render: true,
            value: announcement,
          },
          {
            key: parentAnnouncementKeys.detailGroupNames(),
            value: seedRead("GET /api/groups/", async (signal) => {
              const { data } = await readContract(
                groups.routes["GET /api/groups/"],
                { token, signal },
              );
              return data.map(({ id, name }) => ({ id, name }));
            }),
          },
          {
            key: parentAnnouncementKeys.detailActivityNames(),
            value: seedRead("GET /api/activities/", async (signal) => {
              const { data } = await readContract(
                activities.routes["GET /api/activities/"],
                { token, signal },
              );
              return data.map(({ id, name }) => ({ id, name }));
            }),
          },
          {
            key: parentAnnouncementKeys.pollEvaluation(id),
            value: announcement.then((item) =>
              item && isPoll(item)
                ? seedRead(
                    "parentAnnouncementPollEvaluation",
                    async (signal) => {
                      const [results, children] = await Promise.all([
                        readContract(
                          routes[
                            "GET /api/parent-announcements/{announcementId}/poll-results"
                          ],
                          {
                            token,
                            signal,
                            params: routeParams,
                          },
                        ),
                        readContract(
                          routes[
                            "GET /api/parent-announcements/{announcementId}/poll-children"
                          ],
                          {
                            token,
                            signal,
                            params: routeParams,
                          },
                        ),
                      ]);
                      return {
                        results: mapPollResults(results.data),
                        children: mapPollChildren(children.data),
                      };
                    },
                  )
                : undefined,
            ),
          },
          {
            key: tenantContactKeys.announcementStats(id),
            value: announcement.then((item) =>
              item && showAnnouncementReadStats(item)
                ? seedRead(
                    "GET /api/parent-announcements/{announcementId}/stats",
                    async (signal) =>
                      (
                        await readContract(
                          routes[
                            "GET /api/parent-announcements/{announcementId}/stats"
                          ],
                          {
                            token,
                            signal,
                            params: routeParams,
                          },
                        )
                      ).data,
                  )
                : undefined,
            ),
          },
          {
            key: tenantContactKeys.announcementRecipients(id),
            value: announcement.then((item) =>
              item && showAnnouncementReadStats(item)
                ? seedRead(
                    "GET /api/parent-announcements/{announcementId}/recipients",
                    async (signal) => {
                      const { data } = await readContract(
                        routes[
                          "GET /api/parent-announcements/{announcementId}/recipients"
                        ],
                        {
                          token,
                          signal,
                          params: routeParams,
                        },
                      );
                      return mapAnnouncementRecipients(data);
                    },
                  )
                : undefined,
            ),
          },
          {
            key: parentAnnouncementKeys.letterPlaceholders(),
            value: announcement.then((item) =>
              item && isLetter(item) && hasLetterPlaceholders(item.body)
                ? seedRead(
                    "GET /api/parent-announcements/letter-placeholders",
                    async (signal) =>
                      (
                        await readContract(
                          routes[
                            "GET /api/parent-announcements/letter-placeholders"
                          ],
                          { token, signal },
                        )
                      ).data,
                  )
                : undefined,
            ),
          },
          {
            key: tenantContactKeys.letterStatus(id),
            value: announcement.then((item) =>
              item && isLetter(item) && item.status !== "draft"
                ? seedRead(
                    "GET /api/parent-announcements/{announcementId}/letter-status",
                    async (signal) => {
                      const { data } = await readContract(
                        routes[
                          "GET /api/parent-announcements/{announcementId}/letter-status"
                        ],
                        {
                          token,
                          signal,
                          params: routeParams,
                        },
                      );
                      return mapLetterStatus(data);
                    },
                  )
                : undefined,
            ),
          },
          {
            key: tenantContactKeys.declarationStatus(id),
            value: announcement.then((item) =>
              item &&
              isDeclaration(item) &&
              (item.status !== "draft" || item.declaration_locked_attachments)
                ? seedRead(
                    "GET /api/parent-announcements/{announcementId}/declaration-status",
                    async (signal) => {
                      const { data } = await readContract(
                        routes[
                          "GET /api/parent-announcements/{announcementId}/declaration-status"
                        ],
                        {
                          token,
                          signal,
                          params: routeParams,
                        },
                      );
                      return mapDeclarationStatus(data);
                    },
                  )
                : undefined,
            ),
          },
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
