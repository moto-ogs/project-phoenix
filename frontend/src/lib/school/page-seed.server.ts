import type { Session } from "next-auth";
import { hasPermission } from "~/lib/auth-utils";
import {
  schoolLetterDetailKeys,
  schoolLetterDetails,
} from "./letter-seed-keys";
import * as schoolAuthContract from "~/lib/contract/school-auth.generated";
import * as notificationsContract from "~/lib/contract/school-notifications.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import {
  AUTO_VIEW,
  resolveSupervisionView,
} from "~/lib/school/supervision-view-model";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import * as calendarContract from "~/lib/contract/school-calendar.generated";
import * as classesContract from "~/lib/contract/school-class-day.generated";
import * as lettersContract from "~/lib/contract/school-parent-letters.generated";
import * as messagesContract from "~/lib/contract/school-staff-messages.generated";
import * as supervisionsContract from "~/lib/contract/school-supervisions.generated";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import {
  toAnnouncement,
  mapLetterStatus,
  mapDeclarationStatus,
} from "~/lib/parent-announcements-api";
import { mapSchoolParentConferences } from "~/lib/parent-conferences";
import { mapSchoolCalendar } from "~/lib/personal-calendar-api";
import { getWeekRange } from "~/lib/timetable-helpers";
import {
  mapPlannedInstance,
  mapRoster,
} from "~/lib/timetable-operations-types";
import { cache } from "react";
import * as staffNoticesContract from "~/lib/contract/school-staff-notices.generated";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { toStaffNotice } from "~/lib/staff-notices-api";
import { messageKeys, schoolPortalKeys } from "~/lib/swr/portal-keys";

interface SchoolPageRead {
  key: string;
  load: (token: string) => Promise<unknown>;
  render?: boolean;
  when?: (session: Session) => boolean;
}

async function schoolSnapshot() {
  const snapshot = await readPortalSessionSnapshot("school");
  if (
    !snapshot?.accessToken ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "school" ||
    !snapshot.session.user.tenantId
  )
    return null;
  return snapshot;
}

export function schoolPageSeed(
  reads: readonly SchoolPageRead[],
  dependent?: (token: string) => Promise<readonly SchoolPageRead[]>,
) {
  const builtAt = Date.now();
  const seed = schoolSnapshot()
    .then(async (snapshot) => {
      if (!snapshot) return null;
      const token = snapshot.accessToken;
      const entries = (items: readonly SchoolPageRead[]) =>
        items
          .filter(({ when }) => when?.(snapshot.session) ?? true)
          .map(({ key, load, render = true }) => ({
            key,
            value: load(token),
            render,
          }));
      const independent = entries(reads);
      const additional = dependent ? entries(await dependent(token)) : [];
      return seedOf(snapshot, [...independent, ...additional], builtAt);
    })
    .catch(() => null);
  return { seed, claims: reads.map(({ key }) => key) };
}

// The badge and page share this request, not separate copies of the list.
const loadNotices = cache((token: string) =>
  seedRead("schoolNotices", async (signal) => {
    const { data } = await readContract(
      staffNoticesContract.routes["GET /school/staff-notices/today"],
      { token, signal },
    );
    return data.map(toStaffNotice);
  }),
);

export const schoolNotices = {
  key: schoolPortalKeys.noticesToday(),
  load: loadNotices,
};

export const schoolClasses = {
  key: schoolPortalKeys.classDayClasses(),
  load: (token: string) =>
    seedRead("schoolClasses", async (signal) => {
      const { data } = await readContract(
        classesContract.routes["GET /school/class-day/classes"],
        { token, signal },
      );
      return { ...data, classes: data.classes ?? [] };
    }),
};

export function schoolHomeSeed(date: string) {
  const canViewSchoolDay = (session: Session) =>
    hasPermission(session, "class_day:all_classes");
  return schoolPageSeed([
    schoolNotices,
    { ...schoolClasses, when: canViewSchoolDay },
    {
      key: schoolPortalKeys.assignedClasses(date),
      when: (session) => !canViewSchoolDay(session),
      load: (token) =>
        seedRead("schoolAssignedClasses", async (signal) => {
          const { data } = await readContract(
            classesContract.routes["GET /school/class-day/assigned-classes"],
            { token, signal, query: { date } },
          );
          return data;
        }),
    },
  ]);
}

export const schoolLetters = {
  key: schoolPortalKeys.parentLetters(),
  load: (token: string) =>
    seedRead("schoolLetters", async (signal) => {
      const { data } = await readContract(
        lettersContract.routes["GET /school/parent-letters/"],
        { token, signal },
      );
      return data.map(toAnnouncement);
    }),
};

function schoolLetter(announcementId: string) {
  return {
    key: schoolPortalKeys.parentLetter(announcementId),
    load: cache((token: string) =>
      seedRead("schoolLetter", async (signal) => {
        const { data } = await readContract(
          lettersContract.routes["GET /school/parent-letters/{announcementId}"],
          { token, signal, params: { announcementId } },
        );
        return data.id === announcementId ? toAnnouncement(data) : undefined;
      }),
    ),
  };
}

export const schoolConferences = {
  key: schoolPortalKeys.parentConferences(),
  load: (token: string) =>
    seedRead("schoolConferences", async (signal) => {
      const { data } = await readContract(
        calendarContract.routes["GET /school/calendar/parent-conferences"],
        { token, signal },
      );
      return mapSchoolParentConferences(data);
    }),
};

export function schoolCalendarWeek() {
  const week = getWeekRange(parseISODate(berlinTodayISO()));
  const from = toISODate(week.from);
  const to = toISODate(week.to);
  return {
    key: schoolPortalKeys.calendar(from, to),
    load: (token: string) =>
      seedRead("schoolCalendar", async (signal) => {
        const { data } = await readContract(
          calendarContract.routes["GET /school/calendar/my"],
          { token, signal, query: { from, to } },
        );
        return mapSchoolCalendar(data);
      }),
  };
}

export const schoolInbox = {
  key: messageKeys.teamChatInbox(false),
  load: (token: string) =>
    seedRead("schoolInbox", async (signal) => {
      const { data } = await readContract(
        messagesContract.routes["GET /school/staff-messages/"],
        { token, signal },
      );
      return data;
    }),
};

export function schoolSupervisions() {
  const builtAt = Date.now();
  const today = berlinTodayISO();
  const listKey = schoolPortalKeys.supervisions(today);
  const seed = schoolSnapshot()
    .then(async (snapshot) => {
      if (!snapshot) return null;
      const token = snapshot.accessToken;
      const value = seedRead("schoolSupervisions", async (signal) => {
        const { data } = await readContract(
          supervisionsContract.routes["GET /school/supervisions/"],
          { token, signal },
        );
        if (berlinTodayISO() !== today) return undefined;
        return (data.instances ?? []).map(mapPlannedInstance);
      });
      const entries: ServerSeedEntry[] = [
        { key: listKey, value, render: true },
      ];
      const instances = await value;
      if (instances) {
        const view = resolveSupervisionView(
          AUTO_VIEW,
          [...instances].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        );
        if (view.mode === "detail") {
          const id = view.instance.id;
          entries.push({
            key: schoolPortalKeys.supervisionRoster(id),
            render: true,
            value: seedRead("schoolSupervisionRoster", async (signal) => {
              const { data } = await readContract(
                supervisionsContract.routes[
                  "GET /school/supervisions/{id}/roster"
                ],
                { token, signal, params: { id } },
              );
              if (data.instance.id !== id || berlinTodayISO() !== today)
                return undefined;
              return mapRoster(data);
            }),
          });
        }
      }
      return seedOf(snapshot, entries, builtAt);
    })
    .catch(() => null);
  return { seed, listKey };
}

export const notificationPreferences = {
  key: tenantAdminKeys.notificationPreferences("school"),
  load: (token: string) =>
    seedRead("schoolNotificationPreferences", async (signal) => {
      const { data } = await readContract(
        notificationsContract.routes["GET /school/notifications/preferences/"],
        { token, signal },
      );
      return { ...data, types: data.types ?? [] };
    }),
};

export const trustedDevices = {
  key: tenantAdminKeys.trustedDevices("school"),
  load: (token: string) =>
    seedRead("schoolTrustedDevices", async (signal) => {
      const { data } = await readContract(
        schoolAuthContract.routes["GET /school/auth/mfa/trusted-devices"],
        { token, signal },
      );
      return data ?? [];
    }),
};

export function schoolLetterDetail(id: string) {
  if (!/^[1-9]\d*$/.test(id)) return schoolPageSeed([]);
  const letter = schoolLetter(id);
  const params = { announcementId: id };
  return schoolPageSeed([letter], async (token) => {
    const data = await letter.load(token);
    return (data ? schoolLetterDetails(data) : []).map((part) => ({
      key: schoolLetterDetailKeys[part](id),
      render: false,
      load: () =>
        seedRead(part, async (signal) => {
          switch (part) {
            case "placeholders": {
              const { data } = await readContract(
                lettersContract.routes[
                  "GET /school/parent-letters/letter-placeholders"
                ],
                { token, signal },
              );
              return data;
            }
            case "letterStatus": {
              const { data } = await readContract(
                lettersContract.routes[
                  "GET /school/parent-letters/{announcementId}/letter-status"
                ],
                { token, signal, params },
              );
              return mapLetterStatus(data);
            }
            case "declarationStatus": {
              const { data } = await readContract(
                lettersContract.routes[
                  "GET /school/parent-letters/{announcementId}/declaration-status"
                ],
                { token, signal, params },
              );
              return mapDeclarationStatus(data);
            }
          }
        }),
    }));
  });
}
