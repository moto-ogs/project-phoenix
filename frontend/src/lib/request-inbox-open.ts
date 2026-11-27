import type { Session } from "next-auth";
import { hasEffectiveAdminScope } from "~/lib/auth-utils";
import {
  canReviewChangeRequests,
  resolveChangeRequestAccess,
  type ParentRequestReviewAccess,
} from "~/lib/change-request-access";
import { requestFeedParts } from "~/lib/request-feed-resource";
import { courseWaitlistKeys } from "~/lib/swr/course-waitlist-keys";
import { requestFeedKeys } from "~/lib/swr/portal-keys";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";

export function openRequestInboxKeys(
  session: Session,
  reviewAccess: ParentRequestReviewAccess,
) {
  const accountId = session.user.id;
  const access = resolveChangeRequestAccess(session, reviewAccess);
  const includesParentSource = access.canReviewParentRequests;
  const includesEnrollment = access.canReviewEnrollmentChangeRequests;
  return {
    access,
    accessKey:
      !hasEffectiveAdminScope(session) && canReviewChangeRequests(session)
        ? shellResourceKeys.changeRequestAccess(accountId)
        : null,
    mergedKey: requestFeedKeys.key(
      "request-feed",
      accountId,
      "open",
      requestFeedParts("open", {
        search: "",
        types: [],
        statuses: [],
        includeAggregated: includesParentSource,
        includeEnrollment: includesEnrollment,
      }),
    ),
    withdrawalKey: requestFeedKeys.key(
      "care-withdrawal-feed",
      accountId,
      "open",
      ["", null],
    ),
    waitlistsKey: courseWaitlistKeys.all(),
    staffKey: staffAbsenceKeys.requests(accountId, "open", "", []),
  };
}
