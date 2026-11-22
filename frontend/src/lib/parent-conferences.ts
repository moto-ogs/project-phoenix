// Elternsprechtag (#4801): Die Lehrkraft bietet in moto schule einen Tag für
// eine ihrer Klassen an, die Eltern buchen in der Eltern-App ein freies
// Zeitfenster je Kind. Die Zeitfenster rechnet das Backend aus Beginn, Ende,
// Gesprächslänge und Pausen; diese Datei hält Typen, Aufrufe und die Prüfung
// des Formulars. Die Aufrufe der Eltern-App liegen in `parent-api.ts`.

import { bffJson } from "~/lib/bff-fetch";
import { requiredDay } from "~/lib/contract/required-day";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import type * as schoolCalendarContract from "~/lib/contract/school-calendar.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";

export type ParentConferenceWindow = sharedContract.ParentConferenceWindow;

export type ParentConferenceSlot = schoolCalendarContract.ParentConferenceSlot;

/** Ein Sprechtag, wie ihn die Lehrkraft sieht: mit Belegung. */
export type ParentConference = Omit<
  schoolCalendarContract.ParentConferenceView,
  "date" | "breaks" | "slots"
> & {
  readonly date: string;
  readonly breaks: readonly ParentConferenceWindow[];
  readonly slots: readonly ParentConferenceSlot[];
};

export interface SchoolParentConferenceList {
  readonly conferences: readonly ParentConference[];
  readonly classes: readonly string[];
}

/** Ein Sprechtag, wie ihn die Eltern für ein Kind sehen. */
export type ParentConferenceOffer = Omit<
  parentMeContract.ParentConferenceOffer,
  "date" | "free_slots"
> & {
  readonly date: string;
  readonly free_slots: readonly ParentConferenceWindow[];
};

/** What the form sends; the backend reads it as ParentConferenceRequest. */
export interface ParentConferenceRequest {
  readonly school_class: string;
  readonly date: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly slot_minutes: number;
  readonly breaks: readonly ParentConferenceWindow[];
  readonly location?: string;
}

// Go always sets the day of a Sprechtag; the contract types calendar.Date as
// nullable.
function mapConference(
  raw: schoolCalendarContract.ParentConferenceView,
): ParentConference {
  return {
    ...raw,
    date: requiredDay(raw.date, "parent_conference.date"),
    breaks: raw.breaks ?? [],
    slots: raw.slots ?? [],
  };
}

export function mapParentConferenceOffer(
  raw: parentMeContract.ParentConferenceOffer,
): ParentConferenceOffer {
  return {
    ...raw,
    date: requiredDay(raw.date, "parent_conference_offer.date"),
    free_slots: raw.free_slots ?? [],
  };
}

export const SCHOOL_PARENT_CONFERENCES_ROUTE = "/school/elternsprechtag";

export async function fetchSchoolParentConferences(): Promise<SchoolParentConferenceList> {
  const data = await bffJson(
    "school",
    "GET /school/calendar/parent-conferences",
  );
  return {
    conferences: (data.conferences ?? []).map(mapConference),
    classes: data.classes ?? [],
  };
}

export async function createSchoolParentConference(
  request: ParentConferenceRequest,
): Promise<ParentConference> {
  return mapConference(
    await bffJson("school", "POST /school/calendar/parent-conferences", {
      body: { ...request, breaks: [...request.breaks] },
    }),
  );
}

export async function updateSchoolParentConference(
  id: string,
  request: ParentConferenceRequest,
): Promise<ParentConference> {
  return mapConference(
    await bffJson(
      "school",
      "PUT /school/calendar/parent-conferences/{conferenceId}",
      {
        params: { conferenceId: id },
        body: { ...request, breaks: [...request.breaks] },
      },
    ),
  );
}

export async function deleteSchoolParentConference(id: string): Promise<void> {
  await bffJson(
    "school",
    "DELETE /school/calendar/parent-conferences/{conferenceId}",
    { params: { conferenceId: id } },
  );
}

export interface ParentConferenceDraft {
  readonly schoolClass: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly slotMinutes: string;
  readonly breakStart: string;
  readonly breakEnd: string;
  // The form edits the first break; retain further API-created breaks on save.
  readonly additionalBreaks: readonly ParentConferenceWindow[];
  readonly location: string;
}

export const PARENT_CONFERENCE_SLOT_OPTIONS = ["10", "15", "20", "30"] as const;

export function emptyParentConferenceDraft(
  classes: readonly string[],
): ParentConferenceDraft {
  return {
    schoolClass: classes.length === 1 ? (classes[0] ?? "") : "",
    date: "",
    startTime: "14:00",
    endTime: "17:00",
    slotMinutes: "15",
    breakStart: "",
    breakEnd: "",
    additionalBreaks: [],
    location: "",
  };
}

export function parentConferenceDraftOf(
  conference: ParentConference,
): ParentConferenceDraft {
  const pause = conference.breaks[0];
  return {
    schoolClass: conference.school_class,
    date: conference.date,
    startTime: conference.start_time,
    endTime: conference.end_time,
    slotMinutes: String(conference.slot_minutes),
    breakStart: pause?.start_time ?? "",
    breakEnd: pause?.end_time ?? "",
    additionalBreaks: conference.breaks.slice(1),
    location: conference.location ?? "",
  };
}

/**
 * Die Fehler des Formulars je Feld, mit den Feldnamen des Backends. Die
 * Zeiten kommen aus `<input type="time">` als „HH:MM“ und lassen sich als
 * Text vergleichen.
 */
export function parentConferenceFieldErrors(
  draft: ParentConferenceDraft,
  today: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.schoolClass) errors.school_class = "Bitte wähle eine Klasse.";
  if (!draft.date) errors.date = "Bitte wähle einen Tag.";
  else if (draft.date < today)
    errors.date = "Der Tag liegt in der Vergangenheit.";
  if (!draft.startTime) errors.start_time = "Bitte gib den Beginn an.";
  if (!draft.endTime) errors.end_time = "Bitte gib das Ende an.";
  else if (draft.startTime && draft.endTime <= draft.startTime)
    errors.end_time = "Das Ende muss nach dem Beginn liegen.";
  const hasBreak = draft.breakStart !== "" || draft.breakEnd !== "";
  if (hasBreak) {
    if (
      !draft.breakStart ||
      !draft.breakEnd ||
      draft.breakEnd <= draft.breakStart
    ) {
      errors.breaks = "Die Pause braucht einen Beginn und ein späteres Ende.";
    } else if (
      draft.breakStart <= draft.startTime ||
      draft.breakEnd >= draft.endTime
    ) {
      errors.breaks = "Die Pause muss zwischen Beginn und Ende liegen.";
    }
  }
  return errors;
}

export function parentConferenceRequest(
  draft: ParentConferenceDraft,
): ParentConferenceRequest {
  const location = draft.location.trim();
  return {
    school_class: draft.schoolClass,
    date: draft.date,
    start_time: draft.startTime,
    end_time: draft.endTime,
    slot_minutes: Number(draft.slotMinutes),
    breaks: [
      ...(draft.breakStart && draft.breakEnd
        ? [{ start_time: draft.breakStart, end_time: draft.breakEnd }]
        : []),
      ...draft.additionalBreaks,
    ],
    ...(location ? { location } : {}),
  };
}

/** „14:15–14:30 Uhr“ */
export function parentConferenceWindowLabel(
  window: ParentConferenceWindow,
): string {
  return `${window.start_time}–${window.end_time} Uhr`;
}
