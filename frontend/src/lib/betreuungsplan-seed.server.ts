import { headers } from "next/headers";
import { connection } from "next/server";
import { hasPermission } from "~/lib/auth-utils";
import {
  planGapsKey,
  planInstancesKey,
  planWindowFilter,
  resolvePlanWindow,
  type PlanWindowParams,
} from "~/lib/betreuungsplan-window";
import { incomingClientForwardHeaders } from "~/lib/client-headers.server";
import * as timetableContract from "~/lib/contract/timetable.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { planFilterQuery } from "~/lib/plan-filter";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import type { ServerSeed, ServerSeedEntry } from "~/lib/swr/server-seed";
import { projectTenantResolve, type TenantInfo } from "~/lib/tenant-api";
import { tenantSlugFromHost } from "~/lib/tenant-host";
import { resolveTenantCached } from "~/lib/tenant-resolve.server";
import { mapGaps, mapWeeklyInstances } from "~/lib/timetable-helpers";
import { mapPeriods } from "~/lib/calendar-period-helpers";
import { databaseKeys } from "~/lib/swr/portal-keys";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** The first value, as URLSearchParams.get reads it in the browser. */
function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

async function tenantOf(slug: string): Promise<TenantInfo | null> {
  try {
    const data = await resolveTenantCached(
      slug,
      await incomingClientForwardHeaders(),
    );
    return projectTenantResolve(data, data.settings);
  } catch {
    // The layout decides what a failed lookup shows; the page seeds nothing.
    return null;
  }
}

async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-moto-original-host") ??
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host")
  );
}

/**
 * The Betreuungsplan's first data (#8077): the slim grid and the planning
 * periods it waits for (both shown in the server HTML) and, independently,
 * the gap check a planner's week view loads. Same
 * window, filters and permission gates as the view (resolvePlanWindow); the
 * backend still decides every read. Null without a fresh tenant snapshot of
 * this school on its own host, or while the school keeps the plan off.
 */
export async function loadBetreuungsplanSeed(
  slug: string,
  searchParams: SearchParams,
): Promise<ServerSeed | null> {
  await connection();
  const [snapshot, tenant, host] = await Promise.all([
    readPortalSessionSnapshot("tenant"),
    tenantOf(slug),
    requestHost(),
  ]);
  const session = snapshot?.session;
  const scope = session?.user.scope ?? "";
  if (
    !snapshot ||
    !session ||
    !tenant ||
    snapshot.notBooked ||
    session.error ||
    // Tenant staff only: every other scope is refused by TenantMiddleware.
    (scope !== "" && scope !== "org") ||
    session.user.tenantId !== tenant.tenantId ||
    tenantSlugFromHost(host) !== tenant.subdomain ||
    // The page shows the switched-off state and loads nothing for it.
    tenant.timetableEnabled === false
  ) {
    return null;
  }

  const builtAt = Date.now();
  const params: PlanWindowParams = {
    d: first(searchParams.d),
    view: first(searchParams.view),
    group: first(searchParams.group),
    staff: first(searchParams.staff),
    room: first(searchParams.room),
  };
  const window = resolvePlanWindow({
    params,
    todayISO: berlinTodayISO(),
    weekendOpen: tenant.weekendFollowsFriday === true,
    canManageSchedules: hasPermission(session, "schedules:manage"),
    canFilterByGroup: hasPermission(session, "groups:read"),
    canFilterByRoom: hasPermission(session, "rooms:read"),
  });
  const token = snapshot.accessToken;
  const filter = planWindowFilter(window);
  const entries: ServerSeedEntry[] = [
    // The grid stays a skeleton until the planning periods are known: the
    // server HTML can show it only with them.
    {
      key: databaseKeys.calendarPeriods(),
      render: true,
      value: seedRead("calendarPeriods", async (signal) => {
        const response = await readContract(
          timetableContract.routes["GET /api/timetable/periods/"],
          { token, signal },
        );
        return mapPeriods(response.data);
      }),
    },
  ];
  if (window.shouldLoadInstances) {
    entries.push({
      key: planInstancesKey(window, filter),
      render: true,
      value: seedRead("planInstances", async (signal) => {
        const response = await readContract(
          timetableContract.routes["GET /api/timetable/instances/"],
          {
            token,
            signal,
            query: {
              from: window.fetchFromISO,
              to: window.fetchToISO,
              ...planFilterQuery(filter),
              view: "slim",
            },
          },
        );
        return mapWeeklyInstances(response.data);
      }),
    });
  }
  if (window.shouldLoadGaps) {
    // Not awaited by the server render: the grid does not wait for it.
    entries.push({
      key: planGapsKey(window),
      value: seedRead("planGaps", async (signal) => {
        const response = await readContract(
          timetableContract.routes["GET /api/timetable/gaps"],
          {
            token,
            signal,
            query: { date: window.gapsFromISO, date_to: window.fetchToISO },
          },
        );
        return mapGaps(response.data);
      }),
    });
  }
  return seedOf(snapshot, entries, builtAt);
}
