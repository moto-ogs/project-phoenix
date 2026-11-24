import * as staffNoticesContract from "~/lib/contract/staff-notices.generated";
import * as staffMessagesContract from "~/lib/contract/staff-messages.generated";
import * as staffContract from "~/lib/contract/staff.generated";
import * as roomsContract from "~/lib/contract/rooms.generated";
import * as remindersContract from "~/lib/contract/reminders.generated";
import * as activeContract from "~/lib/contract/active.generated";
import type { Session } from "next-auth";
import { mapAccountTenant } from "~/lib/account-tenants";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isAdmin,
  isCaregiver,
} from "~/lib/auth-utils";
import {
  canReviewCareWithdrawals,
  canReviewEnrollmentChangeRequests,
  resolveChangeRequestAccess,
} from "~/lib/change-request-access";
import { createLogger } from "~/lib/logger";
import { mapProfileResponse } from "~/lib/profile-helpers";
import { contractGet } from "~/lib/contract/client.server";
import type { z } from "zod";
import * as authAccountContract from "~/lib/contract/auth-account.generated";
import * as enrollmentContract from "~/lib/contract/enrollment.generated";
import * as meContract from "~/lib/contract/me.generated";
import * as messagesContract from "~/lib/contract/messages.generated";
import * as studentsContract from "~/lib/contract/students.generated";
import * as platformContract from "~/lib/contract/platform.generated";
import { toRemindersResult } from "~/lib/reminders-api";
import { toStaffNotice } from "~/lib/staff-notices-api";
import type { ShellBootstrap, ShellCounts } from "~/lib/shell-seed";
import type {
  SupervisedGroupPayload,
  SupervisionSnapshot,
} from "~/lib/supervision-derive";
import type { TenantInfo } from "~/lib/tenant-api";
import { loadUserContext } from "~/lib/user-context.server";

const logger = createLogger({ component: "ShellBootstrap" });

/**
 * Upper bound per backend call. The layout must never hang on one slow
 * counter: past the budget the field stays undefined and the browser fetches
 * it as it always did.
 */
const REQUEST_BUDGET_MS = 1500;

/**
 * Resolves to the loaded value, or undefined when the request failed or ran
 * out of budget. Failures are expected (a 403 for a feature this school keeps
 * off, a 404 for an unconfigured integration) and never block the page.
 */
async function optional<T>(
  name: string,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      logger.warn("shell_bootstrap_timeout", { field: name });
      controller.abort();
      resolve(undefined);
    }, REQUEST_BUDGET_MS);
  });
  try {
    return await Promise.race([load(controller.signal), timeout]);
  } catch (error) {
    logger.debug("shell_bootstrap_skipped", {
      field: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readShell<T>(
  route: { method: "GET"; pattern: string; response: z.ZodType<T> },
  token: string,
  signal: AbortSignal,
  endpoint?: string,
): Promise<T> {
  const result = await contractGet(route, { token, signal, endpoint });
  if (!result.ok) throw result.error.cause;
  return result.value;
}

async function loadSupervision(
  session: Session,
  tenant: TenantInfo,
  token: string,
): Promise<SupervisionSnapshot | null> {
  // Same gates as SupervisionProvider: the server answers every request
  // itself, these only skip calls that are guaranteed to 403.
  const adminScope = hasEffectiveAdminScope(session);
  const canReadGroups =
    adminScope ||
    hasPermission(session, "groups:read") ||
    (!Array.isArray(session.user.permissions) && isCaregiver(session));
  const mayHaveOverview =
    adminScope || tenant.operationalOverviewScope === "all_staff";

  const loadSupervised = async (
    signal: AbortSignal,
  ): Promise<{
    supervised: SupervisedGroupPayload[];
    ownSupervised: SupervisedGroupPayload[] | null;
    overviewOk: boolean;
  }> => {
    const loadOwn = () =>
      readShell(
        meContract.routes["GET /api/me/groups/supervised"],
        token,
        signal,
      );
    if (canReadGroups && mayHaveOverview) {
      const [overview, own] = await Promise.allSettled([
        readShell(
          activeContract.routes["GET /api/active/supervisors/all"],
          token,
          signal,
        ),
        loadOwn(),
      ]);
      if (overview.status === "fulfilled") {
        return {
          supervised: overview.value.data ?? [],
          ownSupervised:
            own.status === "fulfilled" ? (own.value.data ?? []) : null,
          overviewOk: true,
        };
      }
      if (own.status === "fulfilled") {
        return {
          supervised: own.value.data ?? [],
          ownSupervised: null,
          overviewOk: false,
        };
      }
      if (overview.status === "rejected") throw overview.reason;
      throw own.reason;
    }
    const own = await loadOwn();
    return {
      supervised: own.data ?? [],
      ownSupervised: null,
      overviewOk: false,
    };
  };

  const [groups, supervision, openRooms] = await Promise.all([
    optional("groups", async (signal) => {
      const response = await readShell(
        studentsContract.routes["GET /api/students/ogs-group-navigation"],
        token,
        signal,
      );
      return response.data;
    }),
    optional("supervised", loadSupervised),
    // Released rooms come from the room list, by stable room id (#3065).
    // rooms:read is the same permission every caregiver already holds for the
    // rest of the navigation, so no extra gate is needed here.
    optional("openRooms", async (signal) => {
      const response = await readShell(
        roomsContract.routes["GET /api/rooms/"],
        token,
        signal,
        "/api/rooms?is_open_room=true",
      );
      return response.data ?? [];
    }),
  ]);

  // SupervisionProvider treats any snapshot as a complete initial load. Do
  // not seed partial data: its ordinary browser request is the recovery path.
  if (
    groups === undefined ||
    supervision === undefined ||
    openRooms === undefined
  ) {
    return null;
  }

  return {
    groups,
    supervised: supervision.supervised,
    ownSupervised: supervision.ownSupervised,
    openRooms: openRooms ?? null,
    overviewOk: supervision.overviewOk,
  };
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
        token,
        signal,
      );
      return (response.data ?? []).length;
    }),
    loadCount(
      "messagesUnread",
      tenant.messagingEnabled && hasPermission(session, "users:read"),
      async (signal) => {
        const response = await readShell(
          messagesContract.routes["GET /api/messages/unread-count"],
          token,
          signal,
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
          token,
          signal,
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
          token,
          signal,
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
          token,
          signal,
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
          token,
          signal,
          "/api/students/care-withdrawals?page_size=1",
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
    optional("userContext", async (signal) => {
      const context = await loadUserContext(token, { signal });
      // An incomplete projection is an error state for useUserContext (it
      // retries); leave that path to the browser instead of caching it.
      return context.incomplete ? undefined : context;
    }),
    // Through the decoder like the browser's profile read: the generated
    // type holds at runtime, IDs arrive as strings (#2353).
    optional("profile", async (signal) => {
      const response = await readShell(
        meContract.routes["GET /api/me/profile"],
        token,
        signal,
      );
      return mapProfileResponse(response.data);
    }),
    optional("accountTenants", async (signal) => {
      const response = await readShell(
        authAccountContract.routes["GET /auth/account/tenants"],
        token,
        signal,
      );
      return (response.data ?? []).map(mapAccountTenant);
    }),
    // Same gate as useReminders: the route needs users:read (#4573).
    hasPermission(session, "users:read")
      ? optional("reminders", async (signal) => {
          const response = await readShell(
            remindersContract.routes["GET /api/reminders/"],
            token,
            signal,
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
            token,
            signal,
          );
          return response.data.map(toStaffNotice);
        })
      : Promise.resolve(undefined),
    optional("announcements", async (signal) => {
      const response = await readShell(
        platformContract.routes["GET /api/platform/announcements/unread"],
        token,
        signal,
      );
      return response.data ?? [];
    }),
    loadSupervision(session, tenant, token),
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
    supervision: supervision ?? undefined,
    counts,
  };
}
