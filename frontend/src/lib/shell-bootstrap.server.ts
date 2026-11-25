import * as staffNoticesContract from "~/lib/contract/staff-notices.generated";
import * as staffMessagesContract from "~/lib/contract/staff-messages.generated";
import * as staffContract from "~/lib/contract/staff.generated";
import * as remindersContract from "~/lib/contract/reminders.generated";
import * as activeContract from "~/lib/contract/active.generated";
import type { Session } from "next-auth";
import { mapAccountTenant } from "~/lib/account-tenants";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isAdmin,
} from "~/lib/auth-utils";
import {
  canReviewCareWithdrawals,
  canReviewEnrollmentChangeRequests,
  resolveChangeRequestAccess,
} from "~/lib/change-request-access";
import { createLogger } from "~/lib/logger";
import { mapProfileResponse } from "~/lib/profile-helpers";
import { readContract, withRequestBudget } from "~/lib/server-seed.server";
import * as authAccountContract from "~/lib/contract/auth-account.generated";
import * as enrollmentContract from "~/lib/contract/enrollment.generated";
import * as meContract from "~/lib/contract/me.generated";
import * as studentsContract from "~/lib/contract/students.generated";
import * as messagesContract from "~/lib/contract/messages.generated";
import * as platformContract from "~/lib/contract/platform.generated";
import { toRemindersResult } from "~/lib/reminders-api";
import { toStaffNotice } from "~/lib/staff-notices-api";
import type { ShellBootstrap, ShellCounts } from "~/lib/shell-seed";
import { isCompleteSupervisionSeed } from "~/lib/supervision-derive";
import type { TenantInfo } from "~/lib/tenant-api";
import { loadUserContext } from "~/lib/user-context.server";

const logger = createLogger({ component: "ShellBootstrap" });

/**
 * Resolves to the loaded value, or undefined when the request failed or ran
 * out of budget (REQUEST_BUDGET_MS). Failures are expected (a 403 for a
 * feature this school keeps off, a 404 for an unconfigured integration) and
 * never block the page.
 */
function optional<T>(
  name: string,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  return withRequestBudget(load, {
    timeout: () => logger.warn("shell_bootstrap_timeout", { field: name }),
    failed: (error) =>
      logger.debug("shell_bootstrap_skipped", {
        field: name,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
}

const readShell = readContract;

async function loadSupervision(token: string) {
  const response = await optional("supervision", (signal) =>
    readShell(activeContract.routes["GET /api/active/supervision-context"], {
      token,
      signal,
    }),
  );
  return response && isCompleteSupervisionSeed(response.data)
    ? response.data
    : undefined;
}

async function loadCount(
  name: keyof ShellCounts,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<number>,
): Promise<number | undefined> {
  return enabled ? optional(name, load) : undefined;
}

/**
 * The badge counters, gated exactly like their hooks (use-*-pending.ts,
 * use-*-unread.ts). A gate that disagrees with its hook is harmless in both
 * directions: the hook ignores a seed it would not have fetched, and fetches
 * whatever the server left out.
 */
async function loadCounts(
  session: Session,
  tenant: TenantInfo,
  token: string,
): Promise<ShellCounts> {
  const canReviewAbsences =
    isAdmin(session) || hasPermission(session, "vacation:approve");
  // Non-admins need the server-side review-access check first
  // (useChangeRequestAccess); only the admin path is known up front.
  const canReviewParentRequests =
    hasEffectiveAdminScope(session) &&
    resolveChangeRequestAccess(session, "admin").canReviewParentRequests;

  const [
    staffAbsencesPending,
    messagesUnread,
    teamChatUnread,
    changeRequestsPending,
    enrollmentRequestsPending,
    careWithdrawalsPending,
  ] = await Promise.all([
    loadCount("staffAbsencesPending", canReviewAbsences, async (signal) => {
      const response = await readShell(
        staffContract.routes["GET /api/staff/absences/pending"],
        { token, signal },
      );
      return (response.data ?? []).length;
    }),
    loadCount(
      "messagesUnread",
      tenant.messagingEnabled && hasPermission(session, "users:read"),
      async (signal) => {
        const response = await readShell(
          messagesContract.routes["GET /api/messages/unread-count"],
          { token, signal },
        );
        return response.data?.unread_count ?? 0;
      },
    ),
    loadCount(
      "teamChatUnread",
      tenant.staffMessagingEnabled,
      async (signal) => {
        const response = await readShell(
          staffMessagesContract.routes["GET /api/staff-messages/unread-count"],
          { token, signal },
        );
        return response.data?.unread_count ?? 0;
      },
    ),
    loadCount(
      "changeRequestsPending",
      canReviewParentRequests,
      async (signal) => {
        const response = await readShell(
          studentsContract.routes[
            "GET /api/students/change-requests/pending-count"
          ],
          { token, signal },
        );
        return response.data?.pending_count ?? 0;
      },
    ),
    loadCount(
      "enrollmentRequestsPending",
      canReviewEnrollmentChangeRequests(session),
      async (signal) => {
        const response = await readShell(
          enrollmentContract.routes[
            "GET /api/enrollment/admin/change-requests/pending-count"
          ],
          { token, signal },
        );
        return response.data?.pending_count ?? 0;
      },
    ),
    loadCount(
      "careWithdrawalsPending",
      canReviewCareWithdrawals(session),
      async (signal) => {
        const response = await readShell(
          studentsContract.routes["GET /api/students/care-withdrawals"],
          { token, signal, query: { page_size: 1 } },
        );
        return response.data?.total ?? 0;
      },
    ),
  ]);

  return {
    staffAbsencesPending,
    messagesUnread,
    teamChatUnread,
    changeRequestsPending,
    enrollmentRequestsPending,
    careWithdrawalsPending,
  };
}

/**
 * Loads, in parallel, everything the tenant app shell fetched one request at
 * a time after hydration (#2973): navigation context, profile, group and
 * supervision navigation, the account's tenants, today's staff notices, and
 * the sidebar badge counts. The settings schema stays out (#4996): only the settings page loads
 * it. Runs once per full page load in the tenant layout; client-side
 * navigations reuse the hydrated caches. `token` is the session's access
 * token, which the browser's session never carries (#5005).
 */
export async function loadShellBootstrap(
  session: Session,
  tenant: TenantInfo,
  token: string,
): Promise<ShellBootstrap> {
  const [
    userContext,
    profile,
    accountTenants,
    reminders,
    staffNoticesToday,
    announcements,
    supervision,
    counts,
  ] = await Promise.all([
    optional("userContext", (signal) => loadUserContext(token, { signal })),
    // Through the decoder like the browser's profile read: the generated
    // type holds at runtime, IDs arrive as strings (#2353).
    optional("profile", async (signal) => {
      const response = await readShell(
        meContract.routes["GET /api/me/profile"],
        { token, signal },
      );
      return mapProfileResponse(response.data);
    }),
    optional("accountTenants", async (signal) => {
      const response = await readShell(
        authAccountContract.routes["GET /auth/account/tenants"],
        { token, signal },
      );
      return (response.data ?? []).map(mapAccountTenant);
    }),
    // Same gate as useReminders: the route needs users:read (#4573).
    hasPermission(session, "users:read")
      ? optional("reminders", async (signal) => {
          const response = await readShell(
            remindersContract.routes["GET /api/reminders/"],
            { token, signal },
          );
          return toRemindersResult(response.data);
        })
      : Promise.resolve(undefined),
    // The list itself, not only its count: the sidebar badge, the home block
    // and /tagesinformationen read it from one SWR entry (#4989). Same gate
    // as useStaffNoticesPending: the route needs users:read.
    hasPermission(session, "users:read")
      ? optional("staffNoticesToday", async (signal) => {
          const response = await readShell(
            staffNoticesContract.routes["GET /api/staff-notices/today"],
            { token, signal },
          );
          return response.data.map(toStaffNotice);
        })
      : Promise.resolve(undefined),
    optional("announcements", async (signal) => {
      const response = await readShell(
        platformContract.routes["GET /api/platform/announcements/unread"],
        { token, signal },
      );
      return response.data ?? [];
    }),
    loadSupervision(token),
    loadCounts(session, tenant, token),
  ]);

  return {
    accountId: session.user.id,
    userContext,
    profile,
    accountTenants,
    reminders,
    staffNoticesToday,
    announcements,
    supervision,
    counts,
  };
}
