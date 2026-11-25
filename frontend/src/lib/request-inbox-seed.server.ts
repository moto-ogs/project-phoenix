import { hasEffectiveAdminScope, hasPermission } from "~/lib/auth-utils";
import { mapCareWithdrawalPage } from "~/lib/care-exit-api";
import {
  canReviewChangeRequests,
  isParentRequestReviewAccess,
  type ParentRequestReviewAccess,
} from "~/lib/change-request-access";
import {
  mapAggregatedOpenPage,
  mapEnrollmentRequestPage,
} from "~/lib/change-request-list-api";
import * as enrollment from "~/lib/contract/enrollment.generated";
import * as staff from "~/lib/contract/staff.generated";
import * as students from "~/lib/contract/students.generated";
import { mapCourseWaitlists } from "~/lib/course-waitlist-helpers";
import { openRequestInboxKeys } from "~/lib/request-inbox-open";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import {
  loadFirstRequestPage,
  WITHDRAWAL_PAGE_SIZE,
  type RequestFeedSource,
} from "~/components/students/requests/request-feed-resource";

export async function loadRequestInboxSeed(slug: string) {
  const builtAt = Date.now();
  const context = await readTenantPageContext(slug);
  if (!context) return null;
  const { session, snapshot, token } = context;
  const entries: ServerSeedEntry[] = [];
  // A prefetched first page may precede any change in this browser. Its
  // negative sequence lies before every tab-local overlay/append.
  const fetchedAt = -builtAt;
  const admin = hasEffectiveAdminScope(session);
  let reviewAccess: ParentRequestReviewAccess = admin ? "admin" : "none";
  if (!admin && canReviewChangeRequests(session)) {
    const accountAccess = seedRead("changeRequestAccess", async (signal) => {
      const answer = await readContract(
        students.routes["GET /api/students/change-requests/access"],
        { token, signal },
      );
      if (!isParentRequestReviewAccess(answer.data.review_access)) {
        throw new Error("Invalid review access");
      }
      return answer.data.review_access;
    });
    entries.push({
      key: shellResourceKeys.changeRequestAccess(session.user.id),
      render: true,
      value: accountAccess,
    });
    const verified = await accountAccess;
    // If the gate fails, the client must decide which tab opens after retry.
    if (!verified) return seedOf(snapshot, entries, builtAt);
    reviewAccess = verified;
  }

  const { access, mergedKey, withdrawalKey, waitlistsKey, staffKey } =
    openRequestInboxKeys(session, reviewAccess);
  if (!access.canOpenParentRequestsTab) {
    if (!access.canReviewStaffAbsenceRequests)
      return seedOf(snapshot, entries, builtAt);
    entries.push({
      key: staffKey,
      render: true,
      value: seedRead("staffAbsenceRequests", async (signal) => ({
        fetchedAt,
        rows: (
          await readContract(staff.routes["GET /api/staff/absences/requests"], {
            token,
            signal,
            query: { view: "open" },
          })
        ).data,
      })),
    });
    return seedOf(snapshot, entries, builtAt);
  }

  if (
    mergedKey &&
    (access.canReviewParentRequests || access.canReviewEnrollmentChangeRequests)
  ) {
    entries.push({
      key: mergedKey,
      render: true,
      value: seedRead("openRequestFeed", (signal) => {
        const sources: RequestFeedSource[] = [];
        if (access.canReviewParentRequests) {
          sources.push({
            key: "aggregated",
            fetchPage: async (cursor) =>
              mapAggregatedOpenPage(
                (
                  await readContract(
                    students.routes["GET /api/students/change-requests"],
                    {
                      token,
                      signal,
                      query: { cursor },
                    },
                  )
                ).data,
              ),
          });
        }
        if (access.canReviewEnrollmentChangeRequests) {
          sources.push({
            key: "enrollment",
            fetchPage: async (cursor) =>
              mapEnrollmentRequestPage(
                (
                  await readContract(
                    enrollment.routes[
                      "GET /api/enrollment/admin/change-requests/list"
                    ],
                    {
                      token,
                      signal,
                      query: { view: "open", cursor },
                    },
                  )
                ).data,
              ),
          });
        }
        return loadFirstRequestPage(sources, fetchedAt);
      }),
    });
  }
  if (withdrawalKey && access.canReviewCareWithdrawals) {
    entries.push({
      key: withdrawalKey,
      render: true,
      value: seedRead("openCareWithdrawals", async (signal) => {
        const page = mapCareWithdrawalPage(
          (
            await readContract(
              students.routes["GET /api/students/care-withdrawals"],
              {
                token,
                signal,
                query: { page: 1, page_size: WITHDRAWAL_PAGE_SIZE },
              },
            )
          ).data,
        );
        return {
          fetchedAt,
          items: page.items,
          hasMore: page.items.length < page.total,
          nextPage: 2,
        };
      }),
    });
  }
  if (hasPermission(session, "users:update")) {
    entries.push({
      key: waitlistsKey,
      value: seedRead("courseWaitlists", async (signal) =>
        mapCourseWaitlists(
          (
            await readContract(
              students.routes[
                "GET /api/students/offering-change-requests/course-waitlists"
              ],
              {
                token,
                signal,
              },
            )
          ).data,
        ),
      ),
    });
  }
  return seedOf(snapshot, entries, builtAt);
}
