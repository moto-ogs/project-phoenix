import type * as birthdaysContract from "~/lib/contract/birthdays.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { bffFile, bffJson } from "./bff-fetch";
import {
  downloadBlob,
  filenameFromDisposition,
  openBlobForPrint,
} from "~/lib/file-download";

/**
 * Birthday display + staff birthday list (#1542).
 *
 * The backend already applies the school settings and the personal opt-outs,
 * so everything returned here is safe to render as-is — the frontend never
 * re-decides who may be shown.
 */

type BirthdayKind = "student" | "staff";
const BIRTHDAY_KINDS: readonly BirthdayKind[] = ["student", "staff"];

export interface BirthdayCelebration {
  kind: BirthdayKind;
  id: string;
  name: string;
  groupName?: string;
  schoolClass?: string;
  /** The day the birthday is SHOWN on ("YYYY-MM-DD"), not always the birth date. */
  date: string;
  /** Completed years reached. Children only — a staff entry never carries one. */
  age?: number;
  isToday: boolean;
}

export interface BirthdayOverview {
  enabled: boolean;
  includeStaff: boolean;
  today: string;
  /** Monday and Sunday of the week shown ("YYYY-MM-DD"). */
  weekStart: string;
  weekEnd: string;
  /** Mondays of the furthest weeks the card may step to. */
  earliestWeekStart: string;
  latestWeekStart: string;
  celebrations: BirthdayCelebration[];
}

export function mapBirthdayOverview(
  response: birthdaysContract.overviewResponse,
): BirthdayOverview {
  return {
    enabled: response.enabled,
    includeStaff: response.include_staff,
    today: response.today,
    weekStart: response.week_start,
    weekEnd: response.week_end,
    earliestWeekStart: response.earliest_week_start,
    latestWeekStart: response.latest_week_start,
    // A kind this build does not know is left out rather than shown as a
    // child or a staff member it may not be.
    celebrations: (response.celebrations ?? []).flatMap((celebration) => {
      const kind = knownEnum(BIRTHDAY_KINDS, celebration.kind);
      if (!kind) return [];
      return [
        {
          kind,
          id: celebration.id,
          name: celebration.name,
          groupName: celebration.group_name,
          schoolClass: celebration.school_class,
          date: celebration.date,
          age: celebration.age,
          isToday: celebration.is_today,
        },
      ];
    }),
  };
}

/**
 * Client-side fetcher for SWR — calls the Next.js BFF route. Without
 * `weekStart` the current week is loaded.
 */
export async function fetchBirthdayOverviewClient(
  weekStart?: string | null,
): Promise<BirthdayOverview> {
  return mapBirthdayOverview(
    await bffJson("tenant", "GET /api/birthdays/", {
      query: { week_start: weekStart || undefined },
      errorMessage: "Birthday fetch failed",
    }),
  );
}

export async function fetchBirthdayOptOut(): Promise<boolean> {
  const data = await bffJson("tenant", "GET /api/birthdays/opt-out", {
    errorMessage: "Birthday opt-out fetch failed",
  });
  return data.opt_out;
}

export async function updateBirthdayOptOut(optOut: boolean): Promise<boolean> {
  const data = await bffJson("tenant", "PUT /api/birthdays/opt-out", {
    body: { opt_out: optOut },
    errorMessage: "Birthday opt-out update failed",
  });
  return data.opt_out;
}

export type StaffBirthdayExportFormat = "pdf" | "docx" | "xlsx";

export interface StaffBirthdayExportRequest {
  format: StaffBirthdayExportFormat;
  title?: string;
  /** Birth months as "01".."12"; empty means the whole year. */
  months?: string[];
}

export async function exportStaffBirthdays(
  request: StaffBirthdayExportRequest,
  printTarget?: Window,
): Promise<void> {
  const response = await bffFile("tenant", "POST /api/birthdays/staff-export", {
    body: request,
    errorMessage: "Staff birthday export failed",
  });
  const blob = await response.blob();
  if (printTarget) {
    await openBlobForPrint(blob, printTarget);
    return;
  }
  downloadBlob(
    blob,
    filenameFromDisposition(response) ??
      `geburtstagsliste-personal.${request.format}`,
  );
}
