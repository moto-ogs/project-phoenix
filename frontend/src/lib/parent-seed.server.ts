import { headers } from "next/headers";
import { cache } from "react";
import * as parentMeContract from "~/lib/contract/parent-me.generated";
import {
  groupThreadSummaryOf,
  parentDocumentsInDisplayOrder,
  parentHolidayOffer,
  parentMealPlanEntry,
  threadSummaryOf,
  type ParentDocumentInbox,
} from "~/lib/parent-api";
import { mapParentConferenceOffer } from "~/lib/parent-conferences";
import { holidayRegistrationEntriesFromBackend } from "~/lib/parent-holiday-registration-entries";
import {
  initialParentChild,
  parentChildCareKeys,
  parentInitialMealMonday,
  parentPageUsesChildren,
  PARENT_CALENDAR_DAYS,
  PARENT_START_CALENDAR_DAYS,
  type ParentSeedPage,
} from "~/lib/parent-page-seed-keys";
import { calendarResponse } from "~/lib/personal-calendar-api";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import {
  readPortalSessionSnapshot,
  type PortalSessionSnapshot,
} from "~/lib/portal-session-snapshot.server";
import {
  PARENT_PUBLIC_PAGES,
  isPortalPublicPath,
} from "~/lib/portal-public-pages";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { parentKeys } from "~/lib/swr/parent-keys";
import type { ServerSeed, ServerSeedEntry } from "~/lib/swr/server-seed";

/**
 * The authorized children of the account, once per server render (#8077):
 * the layout's shell seed and the page's seed share this read. The backend
 * answers only the account's live relationships.
 */
const loadChildren = cache((token: string) =>
  seedRead("parentChildren", async (signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/children"],
      { token, signal },
    );
    return response.data;
  }),
);

/**
 * One read per listed relationship, in parallel. The collection counts only
 * complete: when one child's read fails, the whole key stays unseeded and the
 * browser reader loads it with its partial-failure path.
 */
async function perChild<T>(
  children: readonly parentMeContract.ChildResponse[],
  load: (studentId: string) => Promise<T | undefined>,
): Promise<Record<string, T> | undefined> {
  const values = await Promise.all(
    children.map((child) => load(child.student_id)),
  );
  const result: Record<string, T> = {};
  for (const [index, child] of children.entries()) {
    const value = values[index];
    if (value === undefined) return undefined;
    result[child.student_id] = value;
  }
  return result;
}

const readChildFeatures = cache((token: string, studentId: string) =>
  seedRead("parentFeatures", async (signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/children/{studentId}/features"],
      { token, signal, params: { studentId } },
    );
    return response.data;
  }),
);

const loadFeatures = cache(async (token: string) => {
  const children = await loadChildren(token);
  if (!children) return undefined;
  return perChild(children, (studentId) => readChildFeatures(token, studentId));
});

// The browser shows a 403/404 as "unknown" and handles the refusal; the
// server seeds only answered states and leaves every failure to it.
const loadToday = cache(async (token: string) => {
  const children = await loadChildren(token);
  if (!children) return undefined;
  return perChild(children, (studentId) =>
    seedRead("parentToday", async (signal) => {
      const response = await readContract(
        parentMeContract.routes["GET /parent/me/children/{studentId}/today"],
        { token, signal, params: { studentId } },
      );
      return response.data;
    }),
  );
});

/** A parent snapshot that may carry personal data, else null. */
async function parentSnapshot(): Promise<PortalSessionSnapshot | null> {
  const snapshot = await readPortalSessionSnapshot("parent");
  if (
    !snapshot ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "parent"
  ) {
    return null;
  }
  return snapshot;
}

/**
 * The page the browser asked for, as the proxy recorded it (it overwrites
 * any value the client sent), without the query.
 */
export async function parentRequestPath(): Promise<string | null> {
  const original = (await headers()).get("x-moto-original-path");
  if (!original) return null;
  return original.split("?")[0] ?? null;
}

/** Whether the shell may carry personal data on this path. */
export function isProtectedParentPath(path: string | null): path is string {
  return (
    path !== null && !isPortalPublicPath("parent", PARENT_PUBLIC_PAGES, path)
  );
}

const routes = parentMeContract.routes;

const loadProfile = cache((token: string) =>
  seedRead(
    "parentProfile",
    async (signal) =>
      (await readContract(routes["GET /parent/me/profile"], { token, signal }))
        .data,
  ),
);

const loadThreads = cache((token: string) =>
  seedRead("parentThreads", async (signal) => {
    const { data } = await readContract(routes["GET /parent/me/messages"], {
      token,
      signal,
    });
    return data.map(threadSummaryOf);
  }),
);

const loadGroups = cache((token: string) =>
  seedRead("parentGroupThreads", async (signal) => {
    const { data } = await readContract(
      routes["GET /parent/me/messages/group-threads"],
      { token, signal },
    );
    return data.map(groupThreadSummaryOf);
  }),
);

function loadCalendar(token: string, from: string, days: number) {
  return seedRead("parentCalendar", async (signal) => {
    const end = parseISODate(from);
    end.setDate(end.getDate() + days);
    const { data } = await readContract(routes["GET /parent/me/calendar"], {
      token,
      signal,
      query: { from, to: toISODate(end) },
    });
    return calendarResponse(data);
  });
}

function loadDocuments(
  token: string,
): Promise<ParentDocumentInbox | undefined> {
  // The existing browser reader can show a partial inbox and retry it. A
  // partial answer is not a complete value for its single aggregate key.
  return seedRead("parentDocuments", async (signal) => {
    const [letters, contracts, shared] = await Promise.allSettled([
      readContract(routes["GET /parent/me/documents"], { token, signal }),
      readContract(routes["GET /parent/me/documents/contracts"], {
        token,
        signal,
      }),
      readContract(routes["GET /parent/me/documents/shared"], {
        token,
        signal,
      }),
    ]);
    if (letters.status === "rejected") throw letters.reason;
    if (contracts.status === "rejected") throw contracts.reason;
    if (shared.status === "rejected") throw shared.reason;
    return {
      documents: parentDocumentsInDisplayOrder([
        ...letters.value.data,
        ...contracts.value.data,
      ]),
      shared: shared.value.data,
      failedSource: null,
      error: null,
    };
  });
}

function loadAnnouncements(token: string) {
  return seedRead(
    "parentAnnouncements",
    async (signal) =>
      (await readContract(routes["GET /parent/me/news"], { token, signal }))
        .data,
  );
}

function loadHolidayEntries(token: string) {
  return seedRead("parentHolidayEntries", async (signal) => {
    const { data } = await readContract(
      routes["GET /parent/me/holiday-registration-entries"],
      { token, signal },
    );
    return holidayRegistrationEntriesFromBackend(data);
  });
}

function loadConferences(token: string, studentId: string) {
  return seedRead("parentConferences", async (signal) => {
    const { data } = await readContract(
      routes["GET /parent/me/children/{studentId}/parent-conferences"],
      {
        token,
        signal,
        params: { studentId },
      },
    );
    return data.map(mapParentConferenceOffer);
  });
}

type ChildCareRoute =
  `GET /parent/me/children/{studentId}/${"sick-note" | "excused-requests" | "care-exception" | "pickup-change-requests" | "care-schedule" | "care-offerings" | "courses"}`;

function loadChildCare(
  entries: ServerSeedEntry[],
  token: string,
  child: parentMeContract.ChildResponse,
  day: string,
  profile: boolean,
) {
  const studentId = child.student_id;
  const keys = parentChildCareKeys(studentId, day);
  const entry = (key: string, route: ChildCareRoute): ServerSeedEntry => ({
    key,
    value: seedRead(routes[route].pattern, async (signal) => {
      const { data } = await readContract(routes[route], {
        token,
        signal,
        params: { studentId },
      });
      return data;
    }),
  });
  entries.push(
    entry(keys.sick, "GET /parent/me/children/{studentId}/sick-note"),
    entry(keys.excused, "GET /parent/me/children/{studentId}/excused-requests"),
  );

  // The conversation currently reads the care resources even without an
  // OGS place. The profile skips them when the linked child says so.
  if (!profile || child.without_care_place !== true) {
    entries.push(
      entry(
        keys.exceptions,
        "GET /parent/me/children/{studentId}/care-exception",
      ),
      entry(
        keys.pickup,
        "GET /parent/me/children/{studentId}/pickup-change-requests",
      ),
      entry(keys.schedule, "GET /parent/me/children/{studentId}/care-schedule"),
    );
  }
  if (!profile) return;
  entries.push({
    key: parentKeys.conferences(studentId),
    value: loadConferences(token, studentId),
  });
  if (child.without_care_place !== true) {
    entries.push(
      entry(
        parentKeys.careOfferings(studentId),
        "GET /parent/me/children/{studentId}/care-offerings",
      ),
      entry(
        parentKeys.courses(studentId),
        "GET /parent/me/children/{studentId}/courses",
      ),
    );
  }
}

function loadConversationOverview(
  entries: ServerSeedEntry[],
  token: string,
  child: parentMeContract.ChildResponse,
  day: string,
) {
  const studentId = child.student_id;
  entries.push({
    key: parentInboxKeys.childThreads(studentId),
    value: seedRead("parentChildThreads", async (signal) => {
      const { data } = await readContract(
        routes["GET /parent/me/messages/children/{studentId}/threads"],
        {
          token,
          signal,
          params: { studentId },
        },
      );
      return data.map(threadSummaryOf);
    }),
  });
  loadChildCare(entries, token, child, day, false);
}

function loadSettings(
  entries: ServerSeedEntry[],
  token: string,
  section: "notifications" | "signIn",
) {
  if (section === "notifications") {
    entries.push({
      key: tenantAdminKeys.notificationPreferences("parent"),
      value: seedRead("parentNotificationPreferences", async (signal) => {
        const { data } = await readContract(
          routes["GET /parent/me/notification-preferences/"],
          { token, signal },
        );
        return { ...data, types: data.types ?? [] };
      }),
      render: true,
    });
    return;
  }

  const factor = seedRead("parentMfaStatus", async (signal) => {
    const { data } = await readContract(routes["GET /parent/me/mfa"], {
      token,
      signal,
    });
    return {
      enabled: data.enabled,
      maskedEmail: data.masked_email,
      available: data.available,
    };
  });
  entries.push(
    { key: tenantAdminKeys.emailCodeFactor(), value: factor, render: true },
    {
      key: tenantAdminKeys.trustedDevices("parent"),
      value: factor.then((state) =>
        state?.enabled
          ? seedRead(
              "parentTrustedDevices",
              async (signal) =>
                (
                  await readContract(
                    routes["GET /parent/me/mfa/trusted-devices"],
                    { token, signal },
                  )
                ).data,
            )
          : undefined,
      ),
    },
  );
}

function pageEntries(
  page: ParentSeedPage,
  token: string,
  day: string,
): ServerSeedEntry[] {
  switch (page.kind) {
    case "start":
      return [
        {
          key: parentKeys.holidayOffers(),
          value: seedRead("parentHolidayOffers", async (signal) => {
            const { data } = await readContract(
              routes["GET /parent/me/holiday-registrations"],
              { token, signal },
            );
            return data.map(parentHolidayOffer);
          }),
        },
        {
          key: parentKeys.holidayRegistrationEntries(),
          value: loadHolidayEntries(token),
        },
        { key: parentKeys.announcements(), value: loadAnnouncements(token) },
        { key: parentKeys.messages(), value: loadThreads(token) },
        {
          key: parentKeys.calendar(day, PARENT_START_CALENDAR_DAYS),
          value: loadCalendar(token, day, PARENT_START_CALENDAR_DAYS),
        },
      ];
    case "calendar":
      return [
        {
          key: parentKeys.calendar(day, PARENT_CALENDAR_DAYS),
          value: loadCalendar(token, day, PARENT_CALENDAR_DAYS),
          render: true,
        },
      ];
    case "documents":
      return [
        {
          key: parentInboxKeys.documents(),
          value: loadDocuments(token),
          render: true,
        },
      ];
    case "enrollment":
      return [
        {
          key: parentInboxKeys.enrollableSchools(),
          value: seedRead(
            "parentEnrollableSchools",
            async (signal) =>
              (
                await readContract(
                  routes["GET /parent/me/enrollable-schools"],
                  { token, signal },
                )
              ).data,
          ),
          render: true,
        },
      ];
    case "holiday":
      return [
        {
          key: parentKeys.holidayRegistrationEntries(),
          value: loadHolidayEntries(token),
          render: true,
        },
      ];
    case "messages":
      return [
        {
          key: parentKeys.groupThreads(),
          value: loadGroups(token),
          render: true,
        },
      ];
    case "news":
      return [
        {
          key: parentKeys.announcements(),
          value: loadAnnouncements(token),
          render: true,
        },
      ];
    case "settings": {
      const entries: ServerSeedEntry[] = [];
      loadSettings(entries, token, page.section);
      return entries;
    }
    default:
      return [];
  }
}

/** The protected shell starts only its own reads, without waiting for them. */
export async function loadParentShellSeed(): Promise<ServerSeed | null> {
  const builtAt = Date.now();
  const snapshot = await parentSnapshot();
  if (!snapshot) return null;
  const { accessToken: token } = snapshot;
  const day = berlinTodayISO();
  const children = loadChildren(token);
  const entries: ServerSeedEntry[] = [
    { key: parentKeys.shellChildren(), value: children },
    { key: parentKeys.profile(), value: loadProfile(token) },
    {
      key: parentKeys.messagesUnreadCount(),
      // Preserve the badge's aggregation. Start and messages can share these
      // same list reads within this server render, but only the count goes
      // in the shell payload.
      value: Promise.all([loadThreads(token), loadGroups(token)]).then(
        ([threads, groups]) =>
          threads && groups
            ? [...threads, ...groups].filter((thread) => thread.unread > 0)
                .length
            : undefined,
      ),
    },
    {
      key: parentKeys.newsUnreadCount(),
      value: seedRead(
        "parentNewsUnread",
        async (signal) =>
          (
            await readContract(routes["GET /parent/me/news/unread-count"], {
              token,
              signal,
            })
          ).data.unread_count ?? 0,
      ),
    },
    {
      key: parentKeys.notificationFeed.unreadCount(),
      value: seedRead(
        "parentFeedUnread",
        async (signal) =>
          (
            await readContract(
              routes["GET /parent/me/notifications/feed/unread-count"],
              { token, signal },
            )
          ).data.unread_count,
      ),
    },
  ];
  const linked = await children;
  if (linked)
    entries.push({
      key: parentKeys.features(linked, day),
      value: loadFeatures(token),
    });
  return seedOf(snapshot, entries, builtAt);
}

/** Start independent first-display reads before resolving child relationships. */
export async function loadParentPageSeed(
  page: ParentSeedPage,
): Promise<ServerSeed | null> {
  const builtAt = Date.now();
  const snapshot = await parentSnapshot();
  if (!snapshot) return null;
  const { accessToken: token } = snapshot;
  const day = berlinTodayISO();
  const entries = pageEntries(page, token, day);
  if (!parentPageUsesChildren(page)) return seedOf(snapshot, entries, builtAt);

  const childrenValue = loadChildren(token);
  entries.push({
    key: parentKeys.shellChildren(),
    value: childrenValue,
    render: true,
  });
  const children = await childrenValue;
  if (!children) return seedOf(snapshot, entries, builtAt);

  if (page.kind === "messages") {
    const withCarePlace = children.filter(
      (child) => child.without_care_place !== true,
    );
    if (withCarePlace.length > 1) {
      entries.push({
        key: parentKeys.messages(),
        value: loadThreads(token),
        render: true,
      });
    } else if (withCarePlace[0]) {
      const child = withCarePlace[0];
      entries.push(
        {
          key: parentKeys.features(withCarePlace, day),
          value: perChild(withCarePlace, (id) => readChildFeatures(token, id)),
        },
        { key: parentKeys.today(children, day), value: loadToday(token) },
      );
      loadConversationOverview(entries, token, child, day);
    }
    return seedOf(snapshot, entries, builtAt);
  }

  const child = initialParentChild(
    children,
    "studentId" in page ? page.studentId : undefined,
  );
  // An ID in a URL names a candidate, not a permission. The child's own
  // registered GET then checks its relationship and feature rights again.
  if ("studentId" in page && !child) return seedOf(snapshot, entries, builtAt);

  if (page.kind !== "proof") {
    entries.push({
      key: parentKeys.features(children, day),
      value: loadFeatures(token),
      render:
        page.kind === "start" ||
        page.kind === "conference" ||
        page.kind === "meal",
    });
  }
  if (
    page.kind === "start" ||
    page.kind === "children" ||
    page.kind === "child" ||
    page.kind === "conversation"
  ) {
    entries.push({
      key: parentKeys.today(children, day),
      value: loadToday(token),
      render:
        page.kind === "start" ||
        (page.kind === "children" && children.length > 1),
    });
  }
  if (page.kind === "meal") {
    const features = await loadFeatures(token);
    const eligible = children.filter(
      ({ student_id }) => features?.[student_id]?.meal_plan_enabled,
    );
    const selected =
      eligible.find(({ tenant_id }) => tenant_id === page.school) ??
      eligible[0];
    if (selected) {
      const studentId = selected.student_id;
      const monday = parentInitialMealMonday(day, page.week);
      entries.push({
        key: parentInboxKeys.mealPlan(studentId, monday),
        value: seedRead("parentMealPlan", async (signal) => {
          const { data } = await readContract(
            routes["GET /parent/me/children/{studentId}/meal-plan"],
            {
              token,
              signal,
              params: { studentId },
              query: { week_start: monday },
            },
          );
          return data.map(parentMealPlanEntry);
        }),
        render: true,
      });
    }
  }
  if (child && (page.kind === "child" || page.kind === "children"))
    loadChildCare(entries, token, child, day, true);
  if (child && page.kind === "conference")
    entries.push({
      key: parentKeys.conferences(child.student_id),
      value: loadConferences(token, child.student_id),
      render: true,
    });
  if (child && page.kind === "conversation")
    loadConversationOverview(entries, token, child, day);
  if (child && page.kind === "proof") {
    const { studentId, announcementId } = page;
    entries.push({
      key: parentInboxKeys.declarationProof(announcementId, studentId),
      value: seedRead("parentDeclarationProof", async (signal) => {
        const { data } = await readContract(
          routes["GET /parent/me/news/{announcementId}/declaration/proof"],
          {
            token,
            signal,
            params: { announcementId },
            query: { student_id: studentId },
          },
        );
        return data;
      }),
      render: true,
    });
  }
  return seedOf(snapshot, entries, builtAt);
}
