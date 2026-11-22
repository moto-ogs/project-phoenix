import type * as wire from "~/lib/contract/birthdays.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { apiErrorFromResponse, unavailableApiError } from "./api-error";
import { fetchWithAuth } from "./fetch-with-auth";
import {
  downloadBlob,
  filenameFromDisposition,
  openBlobForPrint,
} from "~/lib/file-download";

/** A request that never reached the API becomes `general.unavailable`. */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await (init ? fetchWithAuth(url, init) : fetchWithAuth(url));
  } catch (error) {
    throw unavailableApiError(error);
  }
}

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
  response: wire.overviewResponse,
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
  const query = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : "";
  const response = await authFetch(`/api/birthdays${query}`);

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Birthday fetch failed: ${response.status}`,
    );
  }

  const json = (await response.json()) as { data: wire.overviewResponse };
  return mapBirthdayOverview(json.data);
}

export async function fetchBirthdayOptOut(): Promise<boolean> {
  const response = await authFetch("/api/birthdays/opt-out");

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Birthday opt-out fetch failed: ${response.status}`,
    );
  }

  const json = (await response.json()) as { data: { opt_out: boolean } };
  return json.data.opt_out;
}

export async function updateBirthdayOptOut(optOut: boolean): Promise<boolean> {
  const response = await authFetch("/api/birthdays/opt-out", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opt_out: optOut }),
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Birthday opt-out update failed: ${response.status}`,
    );
  }

  const json = (await response.json()) as { data: { opt_out: boolean } };
  return json.data.opt_out;
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
  let response: Response;
  try {
    response = await fetch("/api/birthdays/staff-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw unavailableApiError(error);
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response, "Staff birthday export failed");
  }

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
