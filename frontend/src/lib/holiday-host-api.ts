import type * as wire from "~/lib/contract/holiday-guests.generated";
/**
 * Client der Teilnehmerliste für die ausrichtende OGS (#4665). Spricht mit
 * den Next.js-Routen unter /api/holiday-weeks, die mit dem Mitarbeiter-JWT an
 * das Backend weiterreichen. Die Schule sieht nur die bestätigten Kinder der
 * Wochen, die sie ausrichtet, und nur bis zum letzten Tag der Woche.
 * IDs kommen als Strings heraus.
 */

import { bffFile, bffJson } from "~/lib/bff-fetch";
import type * as weeks from "~/lib/contract/holiday-weeks.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import type * as shared from "~/lib/contract/shared.generated";
import { berlinTodayISO, formatDate } from "~/lib/date-helpers";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";

export interface HostedHolidayWeek {
  readonly id: string;
  readonly periodName: string;
  /** Kalendertage als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly participants: number;
  /** „week“: ganze Woche gebucht; „day“: einzelne Tage (#4701). */
  readonly bookingUnit: "week" | "day";
  /**
   * Betreuungszeit der Woche als „HH:MM“: frühester Beginn und spätestes
   * Ende ihrer Zeitmodelle; leer ohne Zeitmodell.
   */
  readonly careStartsAt: string;
  readonly careEndsAt: string;
  /**
   * Bestätigte Kinder je gebuchtem Tag einer tageweise gebuchten Woche,
   * „YYYY-MM-DD“ → Anzahl. Leer bei einer ganzen Woche.
   */
  readonly dayParticipants: ReadonlyMap<string, number>;
  /** Gruppe der Feriengäste dieser Woche (#4666), `null` vor der Wahl. */
  readonly guestGroupId: string | null;
  /** Feriengäste in dieser Gruppe, deren Zugriff nicht vorzeitig endete. */
  readonly guests: number;
  /** Die Woche bietet Mittagessen an (#5631). */
  readonly lunchOffered?: boolean;
  /**
   * Essen der bestätigten Kinder je Betreuungstag der Woche, in
   * Kalenderreihenfolge. Nur die Teilnehmerliste füllt sie.
   */
  readonly lunches?: readonly {
    readonly date: string;
    readonly count: number;
  }[];
}

export interface HolidayTimeModelCount {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly count: number;
}

export interface HolidayHomeSchoolCount {
  /** `null` zählt die Feriengäste ohne Schule des Trägers. */
  readonly schoolId: string | null;
  readonly name: string;
  readonly count: number;
}

/**
 * Antwort auf eine Frage, die der Träger für die OGS freigibt (#5202). In
 * `answers` nur Fragen ohne Gesundheitsangabe; Antworten auf Gesundheitsfragen
 * stehen in `health` (#4722). `value` ist `true`/`false` bei Ja/Nein, die
 * gewählte Antwort bei einer Auswahl, ein Kalendertag „YYYY-MM-DD“ bei einem
 * Datum, sonst der Text; `null` ohne Antwort.
 */
export interface HolidayHostAnswer {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly value: boolean | string | null;
}

/**
 * Die Gesundheitsangaben eines Kindes aus der Ferienanmeldung (#4722): nur,
 * wenn die Eltern der Weitergabe an die OGS zugestimmt haben.
 */
export interface HolidayHostHealth {
  readonly allergies: string;
  readonly medication: string;
  readonly healthNotes: string;
  readonly answers: HolidayHostAnswer[];
}

/** A free answer arrives as JSON; this build reads a yes/no, a text or nothing. */
function mapAnswers(
  answers: readonly shared.HolidayHostAnswer[] | null | undefined,
): HolidayHostAnswer[] {
  return (answers ?? []).map((answer) => ({
    key: answer.key,
    label: answer.label,
    type: answer.type,
    value:
      typeof answer.value === "boolean" || typeof answer.value === "string"
        ? answer.value
        : null,
  }));
}

function mapHealth(
  health: shared.HolidayHostHealth | null,
): HolidayHostHealth | null {
  if (!health) return null;
  return {
    allergies: health.allergies,
    medication: health.medication,
    healthNotes: health.health_notes,
    answers: mapAnswers(health.answers),
  };
}

/** A day the contract names as nullable; the screens read "" as unknown. */
function day(value: string | null): string {
  return value ?? "";
}

function days(values: readonly (string | null)[] | null | undefined): string[] {
  return (values ?? []).filter((value): value is string => value !== null);
}

/** Eine freigegebene Frage der Liste: eine Spalte. */
interface HolidayHostQuestion {
  readonly key: string;
  readonly label: string;
  readonly type: string;
}

/** Die zweite sorgeberechtigte Person: Name und Telefon, keine E-Mail. */
interface HolidayHostGuardian {
  readonly name: string;
  readonly phone: string;
}

/**
 * Eine freiwillige Einwilligung aus der Ferienanmeldung (#8038, ADR 0321),
 * live aus der Anmeldung: Ein Widerruf der Eltern steht mit dem nächsten
 * Abruf hier. `changedAt` ist, seit wann sie gilt oder seit wann sie
 * widerrufen ist; `null`, wenn die Eltern sie nie gegeben haben.
 */
export interface HolidayHostConsent {
  readonly key: string;
  readonly title: string;
  readonly label: string;
  readonly given: boolean;
  readonly changedAt: string | null;
}

function mapConsents(
  consents: readonly shared.HolidayRegistrationConsent[] | null | undefined,
): HolidayHostConsent[] {
  return (consents ?? []).map((consent) => ({
    key: consent.key,
    title: consent.title,
    label: consent.label,
    given: consent.given,
    changedAt: consent.changed_at,
  }));
}

export interface HolidayParticipant {
  readonly childId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string;
  /** `null` bei einem Feriengast. */
  readonly homeSchoolId: string | null;
  readonly homeSchoolName: string;
  readonly timeModelId: string;
  /** Gebuchte Tage einer tageweise gebuchten Woche (#4701); leer: ganze Woche. */
  readonly days?: readonly string[];
  /** Das Kind isst an seinen Betreuungstagen zu Mittag (#5631). */
  readonly lunch?: boolean;
  /** `null` ohne zweite sorgeberechtigte Person. */
  readonly secondGuardian: HolidayHostGuardian | null;
  readonly answers: HolidayHostAnswer[];
  /** `null` ohne Gesundheitsangaben oder ohne Zustimmung der Eltern. */
  readonly health: HolidayHostHealth | null;
  /** Die freiwilligen Einwilligungen der Anmeldung; leer, wenn das Formular keine fragt. */
  readonly consents: HolidayHostConsent[];
}

export interface HolidayParticipantList {
  readonly week: HostedHolidayWeek;
  readonly timeModels: HolidayTimeModelCount[];
  readonly homeSchools: HolidayHomeSchoolCount[];
  /** Die freigegebenen Fragen; leer, wenn der Träger keine freigibt. */
  readonly questions: HolidayHostQuestion[];
  readonly participants: HolidayParticipant[];
}

/** Eine Antwort zum Lesen: „Ja“, „Nein“, ein deutsches Datum oder der Text. */
export function formatHolidayHostAnswer(
  answer: Pick<HolidayHostAnswer, "type" | "value"> | undefined,
): string {
  if (answer === undefined || answer.value === null) return "–";
  if (typeof answer.value === "boolean") return answer.value ? "Ja" : "Nein";
  if (answer.type === "date") return formatDate(answer.value);
  return answer.value;
}

export function mapWeek(week: weeks.HostedHolidayWeek): HostedHolidayWeek {
  return {
    id: week.id,
    periodName: week.period_name,
    startsOn: day(week.starts_on),
    endsOn: day(week.ends_on),
    participants: week.participants,
    bookingUnit: week.booking_unit === "day" ? "day" : "week",
    careStartsAt: week.care_starts_at,
    careEndsAt: week.care_ends_at,
    dayParticipants: new Map(
      (week.day_participants ?? []).flatMap((entry) =>
        entry.date === null ? [] : [[entry.date, entry.participants]],
      ),
    ),
    guestGroupId: week.guest_group_id,
    guests: week.guests,
    // Only a week with lunch carries the fields (#5631).
    ...(week.lunch_offered
      ? {
          lunchOffered: true,
          lunches: (week.lunches ?? []).flatMap((entry) =>
            entry.date === null
              ? []
              : [{ date: entry.date, count: entry.participants }],
          ),
        }
      : {}),
  };
}

/** Die Antwort des Backends in der Form der Oberfläche. */
function mapHolidayParticipantList(
  list: weeks.HolidayParticipantListResponse,
): HolidayParticipantList {
  return {
    week: mapWeek(list.week),
    timeModels: (list.time_models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      startsAt: model.starts_at,
      endsAt: model.ends_at,
      count: model.count,
    })),
    homeSchools: (list.home_schools ?? []).map((school) => ({
      schoolId: school.school_id,
      name: school.name,
      count: school.count,
    })),
    questions: list.questions ?? [],
    participants: (list.participants ?? []).map((participant) => ({
      childId: participant.child_id,
      firstName: participant.first_name,
      lastName: participant.last_name,
      birthDate: day(participant.birth_date),
      homeSchoolId: participant.home_school_id,
      homeSchoolName: participant.home_school_name,
      timeModelId: participant.time_model_id,
      ...(days(participant.days).length
        ? { days: days(participant.days) }
        : {}),
      ...(participant.lunch ? { lunch: true } : {}),
      secondGuardian: participant.second_guardian,
      answers: mapAnswers(participant.answers),
      health: mapHealth(participant.health),
      consents: mapConsents(participant.consents),
    })),
  };
}

/** Die Wochen, die die Schule ausrichtet und die noch nicht vorbei sind. */
export async function fetchHostedHolidayWeeks(): Promise<HostedHolidayWeek[]> {
  const hosted = await bffJson("tenant", "GET /api/holiday-weeks/", {
    errorMessage: "Ferienwochen konnten nicht geladen werden",
  });
  return hosted.map(mapWeek);
}

/** Die Teilnehmerliste einer Woche. Jeder Abruf steht im Zugriffsprotokoll. */
export async function fetchHolidayParticipants(
  weekId: string,
): Promise<HolidayParticipantList> {
  return mapHolidayParticipantList(
    await bffJson("tenant", "GET /api/holiday-weeks/{weekId}/participants", {
      params: { weekId },
      errorMessage: "Teilnehmerliste konnte nicht geladen werden",
    }),
  );
}

/**
 * Lädt die Teilnehmerliste als CSV oder Excel unter dem Dateinamen des
 * Backends. Erst holen, dann speichern: ein Fehler bleibt als Meldung auf der
 * Seite.
 */
export async function downloadHolidayParticipants(
  weekId: string,
  format: "csv" | "xlsx",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/holiday-weeks/{weekId}/participants/export",
    {
      params: { weekId },
      query: { format },
      errorMessage: "Die Datei konnte nicht erstellt werden",
    },
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `teilnehmerliste.${format}`,
  );
}

// ─── Feriengäste (#4666) ────────────────────────────────────────────────────

export interface HolidayGuestContact {
  readonly name: string;
  readonly phone: string;
  readonly relationship: string;
}

/**
 * Was die ausrichtende OGS von einem Feriengast über den Namen hinaus sieht:
 * Betreuung, Notfall und Abholung, dazu die Antworten, die der Träger
 * freigibt (#5202), und die Gesundheitsangaben (#4722).
 */
export interface HolidayGuestSheet {
  readonly studentId: string;
  /** Kalendertage der Ferienwoche als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly timeModelName: string;
  readonly timeModelStartsAt: string;
  readonly timeModelEndsAt: string;
  /** Der Gast isst an seinen Betreuungstagen zu Mittag (#5631). */
  readonly lunch?: boolean;
  /** `null` bei einem Kind ohne Schule des Trägers. */
  readonly homeSchoolId: string | null;
  readonly guestSchoolName: string;
  /** Die Schule, die der Hinweis „Gast aus …“ nennt; leer für „Feriengast“ (#5630). */
  readonly schoolName: string;
  readonly emergencyContacts: HolidayGuestContact[];
  readonly pickupContacts: HolidayGuestContact[];
  readonly answers: HolidayHostAnswer[];
  /** `null` ohne Gesundheitsangaben oder ohne Zustimmung der Eltern. */
  readonly health: HolidayHostHealth | null;
  /**
   * Ob die Heimatschule gerade eine Foto-Einwilligung für das Kind hat
   * (#4721). moto fragt bei jedem Abruf neu; ein Widerruf der Eltern gilt
   * deshalb sofort. `null` ohne Heimatschule beim Träger und nach der Woche.
   */
  readonly homePhotoConsent: boolean | null;
  /**
   * Ob Raumverlauf und Stimmung an der Heimatschule gerade gestoppt sind
   * (#8037), live gelesen wie die Foto-Einwilligung. `null` in denselben
   * Fällen.
   */
  readonly homeRoomHistoryStopped: boolean | null;
  /**
   * Die freiwilligen Einwilligungen aus der Ferienanmeldung (#8038), live
   * gelesen. Leer ohne Einwilligungen im Formular und nach der Woche.
   */
  readonly consents: HolidayHostConsent[];
  /** Nach dem letzten Tag der Woche: nur noch sieben Tage zum Nachlesen. */
  readonly readOnly: boolean;
}

/** Die Klasse, unter der ein Feriengast in der ausrichtenden OGS steht. */
export const HOLIDAY_GUEST_SCHOOL_CLASS = "Feriengast";

/**
 * Der Hinweis an einem Feriengast (#5630), überall gleich: „Gast aus“ und die
 * Heimatschule oder die Schule, die die Eltern genannt haben; ohne Schule
 * „Feriengast“.
 */
export function holidayGuestLabel(schoolName: string): string {
  const name = schoolName.trim();
  return name ? `Gast aus ${name}` : HOLIDAY_GUEST_SCHOOL_CLASS;
}

/** Hinweis eines Feriengasts, den die Schule heute betreut. */
export interface HolidayGuestBadge {
  readonly studentId: string;
  readonly schoolName: string;
}

/**
 * Die Hinweise aller Feriengäste, die die Schule heute betreut (#5630).
 * Vor und nach ihrer Woche stehen Gäste in keiner Liste und haben keinen.
 */
export function holidayGuestIds(
  students: readonly {
    readonly id: string;
    readonly school_class?: string | null;
  }[],
): string[] {
  return students
    .filter((student) => student.school_class === HOLIDAY_GUEST_SCHOOL_CLASS)
    .map((student) => student.id);
}

export function mapHolidayGuestBadges(
  badges: readonly wire.HolidayGuestBadge[],
  studentIds: readonly string[],
): HolidayGuestBadge[] {
  const visible = new Set(studentIds);
  return badges
    .filter((badge) => visible.has(badge.student_id))
    .map((badge) => ({
      studentId: badge.student_id,
      schoolName: badge.school_name,
    }));
}

export async function fetchHolidayGuestBadges(
  studentIds: readonly string[],
): Promise<HolidayGuestBadge[]> {
  const badges = await bffJson("tenant", "GET /api/holiday-guests/", {
    errorMessage:
      "Die Hinweise zu den Feriengästen konnten nicht geladen werden",
  });
  return mapHolidayGuestBadges(badges, studentIds);
}

/** Was die Wahl der Feriengruppe bewirkt hat. */
export interface HolidayGuestTransfer {
  /** Feriengäste, die in der Gruppe stehen oder am ersten Tag dazukommen. */
  readonly guests: number;
  /** Eigene Kinder, deren gebuchte Tage jetzt eingeplant sind (#6678). */
  readonly ownChildren: number;
}

/**
 * Eine Gruppe, die die Schule als Feriengruppe einer Woche gewählt hat
 * (ADR 0120, Nachtrag 2026-11-11). Vor dem ersten Tag der Woche sind die
 * Feriengäste noch in keiner Gruppe; die Gruppe steht dann leer da.
 */
export interface HolidayGuestGroup {
  readonly groupId: string;
  readonly weekId: string;
  /** Kalendertage als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  /** Feriengäste der Woche, deren Zugriff nicht vorzeitig endete. */
  readonly guests: number;
}

/**
 * Die Feriengruppen der Schule, deren Woche noch nicht vorbei ist, nach dem
 * ersten Tag geordnet.
 */
export async function fetchHolidayGuestGroups(): Promise<HolidayGuestGroup[]> {
  const groups = await bffJson("tenant", "GET /api/holiday-guests/groups", {
    errorMessage: "Die Feriengruppen konnten nicht geladen werden",
  });
  return groups.map(mapHolidayGuestGroup);
}

export function mapHolidayGuestGroup(
  group: wire.HolidayGuestGroup,
): HolidayGuestGroup {
  return {
    groupId: group.group_id,
    weekId: group.week_id,
    startsOn: day(group.starts_on),
    endsOn: day(group.ends_on),
    guests: group.guests,
  };
}

/** „04.–08.01.2027“, über Monate „29.06.–03.07.2027“, über Jahre ganz. */
export function formatHolidayWeekRange(
  startsOn: string,
  endsOn: string,
): string {
  const [fromYear, fromMonth, fromDay] = startsOn.split("-");
  const [toYear, toMonth, toDay] = endsOn.split("-");
  const to = `${toDay}.${toMonth}.${toYear}`;
  // A week of a single day, such as an extra care day (#4817).
  if (startsOn === endsOn) return to;
  if (fromYear !== toYear) return `${fromDay}.${fromMonth}.${fromYear}–${to}`;
  if (fromMonth !== toMonth) return `${fromDay}.${fromMonth}.–${to}`;
  return `${fromDay}.–${to}`;
}

/** Der Hinweis an einer Feriengruppe in der Gruppenverwaltung. */
export interface HolidayGuestGroupHint {
  /** „Feriengruppe 04.–08.01.2027“ */
  readonly label: string;
  /** Ein bis drei kurze Sätze: wer kommt wann, und was das heißt. */
  readonly message: string;
}

/**
 * Erklärt eine Feriengruppe (ADR 0120, Nachtrag 2026-11-11). Vor der Woche
 * kommen die Feriengäste erst am ersten Tag in die Gruppe. Eine Gruppe ohne
 * eigene Kinder steht bis dahin nicht unter „Gruppen“; Raum und
 * Gruppenleitung kann die Leitung schon vorher festlegen.
 */
export function holidayGuestGroupHint(
  group: HolidayGuestGroup,
  today: string,
  ownChildren: number,
): HolidayGuestGroupHint {
  const label = `Feriengruppe ${formatHolidayWeekRange(group.startsOn, group.endsOn)}`;
  const guests =
    group.guests === 1 ? "1 Feriengast" : `${group.guests} Feriengäste`;
  if (group.startsOn <= today) {
    const message =
      group.guests === 0
        ? "Diese Woche sind keine Feriengäste angemeldet."
        : `${guests} ${group.guests === 1 ? "ist" : "sind"} diese Woche in der Gruppe.`;
    return { label, message };
  }
  const [, month, day] = group.startsOn.split("-");
  const arrival =
    group.guests === 0
      ? "Noch sind keine Feriengäste angemeldet."
      : `${guests} ${group.guests === 1 ? "kommt" : "kommen"} am ${day}.${month}. in die Gruppe.`;
  const waiting =
    ownChildren > 0
      ? ""
      : ` Bis zum ${day}.${month}. steht die Gruppe nicht unter „Gruppen“.`;
  return {
    label,
    message: `${arrival}${waiting} Raum und Gruppenleitung kannst du schon jetzt festlegen.`,
  };
}

/**
 * Wählt die Gruppe für die Feriengäste einer Woche. Das Backend übernimmt
 * die bestätigten Gäste sofort, plant die gebuchten Tage der eigenen Kinder
 * ein und gibt beide Zahlen zurück.
 */
export async function assignHolidayGuestGroup(
  weekId: string,
  groupId: string,
): Promise<HolidayGuestTransfer> {
  const data = await bffJson(
    "tenant",
    "PUT /api/holiday-weeks/{weekId}/guest-group",
    {
      params: { weekId },
      body: { group_id: groupId },
      errorMessage: "Die Feriengäste konnten nicht übernommen werden",
    },
  );
  return { guests: data.guests, ownChildren: data.own_children };
}

/** Betreuung, Notfall und Abholung eines Feriengasts. Jeder Abruf steht im Zugriffsprotokoll. */
export async function fetchHolidayGuestSheet(
  studentId: string,
): Promise<HolidayGuestSheet> {
  const sheet = await bffJson("tenant", "GET /api/holiday-guests/{studentId}", {
    params: { studentId },
    errorMessage: "Die Angaben zum Feriengast konnten nicht geladen werden",
  });
  return {
    studentId: sheet.student_id,
    startsOn: day(sheet.starts_on),
    endsOn: day(sheet.ends_on),
    timeModelName: sheet.time_model_name,
    timeModelStartsAt: sheet.time_model_starts_at,
    timeModelEndsAt: sheet.time_model_ends_at,
    ...(sheet.lunch ? { lunch: true } : {}),
    homeSchoolId: sheet.home_school_id,
    guestSchoolName: sheet.guest_school_name,
    schoolName: sheet.school_name,
    emergencyContacts: sheet.emergency_contacts ?? [],
    pickupContacts: sheet.pickup_contacts ?? [],
    answers: mapAnswers(sheet.answers),
    health: mapHealth(sheet.health),
    homePhotoConsent: sheet.home_photo_consent ?? null,
    homeRoomHistoryStopped: sheet.home_room_history_stopped ?? null,
    consents: mapConsents(sheet.consents),
    readOnly: sheet.read_only,
  };
}

// ─── Eigene Kinder der ausrichtenden OGS (#4722) ────────────────────────────

/**
 * Was eine bestätigte Ferienanmeldung zur Gesundheit eines eigenen Kindes
 * angibt, für eine Woche, die die Schule ausrichtet. Es ändert das
 * Gesundheitsfeld der Schule nicht.
 */
export interface HolidayStudentHealth {
  readonly weekId: string;
  readonly periodName: string;
  /** Kalendertage der Ferienwoche als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly health: HolidayHostHealth;
}

/**
 * Die Gesundheitsangaben der Ferienanmeldungen eines eigenen Kindes bis zum
 * letzten Tag der Woche. Jeder Abruf mit Angaben steht im Zugriffsprotokoll.
 */
export async function fetchHolidayStudentHealth(
  studentId: string,
): Promise<HolidayStudentHealth[]> {
  const entries = await bffJson(
    "tenant",
    "GET /api/holiday-weeks/students/{studentId}/health",
    {
      params: { studentId },
      errorMessage:
        "Die Angaben aus der Ferienanmeldung konnten nicht geladen werden",
    },
  );
  return entries.map((entry) => ({
    weekId: entry.week_id,
    periodName: entry.period_name,
    startsOn: day(entry.starts_on),
    endsOn: day(entry.ends_on),
    health: mapHealth(entry.health) ?? {
      allergies: "",
      medication: "",
      healthNotes: "",
      answers: [],
    },
  }));
}

// ─── Eigene Kinder in der Ferienwoche (#6678) ───────────────────────────────

/**
 * Ob die Anmeldung eines eigenen Kindes einem Kind der Schule zugeordnet
 * ist: genau eines passt, keines passt oder mehrere passen.
 */
type HolidayOwnChildAssignmentState = "matched" | "not_found" | "ambiguous";

const ASSIGNMENT_STATES: readonly HolidayOwnChildAssignmentState[] = [
  "matched",
  "not_found",
  "ambiguous",
];

/** An unknown state reads as "not_found": the screen offers no match. */
function assignmentState(value: string): HolidayOwnChildAssignmentState {
  return knownEnum(ASSIGNMENT_STATES, value) ?? "not_found";
}

export interface HolidayOwnChildAssignment {
  /** Das Kind der Teilnehmerliste. */
  readonly childId: string;
  readonly assignment: HolidayOwnChildAssignmentState;
  /** Die Kinderakte, wenn genau ein Kind passt. */
  readonly studentId: string | null;
}

/**
 * Die Zuordnung der eigenen Kinder einer Woche. Kinder anderer Schulen und
 * Kinder ohne Schule stehen nicht darin.
 */
export async function fetchHolidayOwnChildAssignments(
  weekId: string,
): Promise<HolidayOwnChildAssignment[]> {
  const entries = await bffJson(
    "tenant",
    "GET /api/holiday-weeks/{weekId}/own-children",
    {
      params: { weekId },
      errorMessage:
        "Die eigenen Kinder der Ferienwoche konnten nicht geladen werden",
    },
  );
  return entries.map(mapHolidayOwnChildAssignment);
}

export function mapHolidayOwnChildAssignment(
  entry: weeks.HolidayOwnChildAssignment,
): HolidayOwnChildAssignment {
  return {
    childId: entry.child_id,
    assignment: assignmentState(entry.assignment),
    studentId: entry.student_id,
  };
}

// ─── Eigene Kinder in Ferienwochen anderer OGS (#6679) ──────────────────────

/**
 * Die bestätigte Ferienbuchung eines Kindes dieser OGS in einer Woche, die
 * eine andere OGS desselben Trägers ausrichtet. Ohne Gesundheitsangaben und
 * Kontakte: Die Heimatschule plant damit und informiert die Familie.
 */
export interface HolidayHomeSchoolBooking {
  /** Das Kind der Anmeldung beim Träger. */
  readonly childId: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Geburtsdatum als „YYYY-MM-DD“. */
  readonly birthDate: string;
  readonly weekId: string;
  readonly periodName: string;
  /** Kalendertage der Ferienwoche als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolId: string;
  readonly hostSchoolName: string;
  readonly timeModelName: string;
  readonly timeModelStartsAt: string;
  readonly timeModelEndsAt: string;
  /** Gebuchte Tage einer tageweise gebuchten Woche; leer: ganze Woche. */
  readonly days: readonly string[];
  /** Das Kind isst dort zu Mittag (#5631). */
  readonly lunch?: boolean;
  readonly assignment: HolidayOwnChildAssignmentState;
  /** Die Kinderakte, wenn genau ein Kind der OGS passt. */
  readonly studentId: string | null;
}

/**
 * Die eigenen Kinder in Ferienwochen anderer OGS, bis zum letzten Tag der
 * Woche. Jeder Abruf mit Kindern steht im Zugriffsprotokoll.
 */
export async function fetchHolidayHomeSchoolBookings(): Promise<
  HolidayHomeSchoolBooking[]
> {
  const entries = await bffJson(
    "tenant",
    "GET /api/holiday-weeks/home-school-children",
    {
      errorMessage:
        "Die Kinder in Ferienwochen anderer OGS konnten nicht geladen werden",
    },
  );
  return entries.map((entry) => ({
    childId: entry.child_id,
    firstName: entry.first_name,
    lastName: entry.last_name,
    birthDate: day(entry.birth_date),
    weekId: entry.week_id,
    periodName: entry.period_name,
    startsOn: day(entry.starts_on),
    endsOn: day(entry.ends_on),
    hostSchoolId: entry.host_school_id,
    hostSchoolName: entry.host_school_name,
    timeModelName: entry.time_model_name,
    timeModelStartsAt: entry.time_model_starts_at,
    timeModelEndsAt: entry.time_model_ends_at,
    days: days(entry.days),
    ...(entry.lunch ? { lunch: true } : {}),
    assignment: assignmentState(entry.assignment),
    studentId: entry.student_id,
  }));
}

/**
 * Was eine bestätigte Ferienanmeldung zu Betreuung, Notfall und Abholung
 * eines eigenen Kindes angibt, für eine Woche, die die Schule ausrichtet.
 * Die Stammdaten der Schule bleiben unverändert.
 */
export interface HolidayStudentRegistration {
  readonly weekId: string;
  readonly periodName: string;
  /** Kalendertage der Ferienwoche als „YYYY-MM-DD“. */
  readonly startsOn: string;
  readonly endsOn: string;
  /** Gebuchte Tage einer tageweise gebuchten Woche; leer: ganze Woche. */
  readonly days: readonly string[];
  readonly timeModelName: string;
  readonly timeModelStartsAt: string;
  readonly timeModelEndsAt: string;
  /** Das Kind isst an seinen Betreuungstagen zu Mittag (#5631). */
  readonly lunch?: boolean;
  readonly emergencyContacts: HolidayGuestContact[];
  readonly pickupContacts: HolidayGuestContact[];
}

/**
 * Die Angaben der Ferienanmeldungen eines eigenen Kindes bis zum letzten Tag
 * der Woche. Jeder Abruf mit Angaben steht im Zugriffsprotokoll.
 */
export async function fetchHolidayStudentRegistrations(
  studentId: string,
): Promise<HolidayStudentRegistration[]> {
  const entries = await bffJson(
    "tenant",
    "GET /api/holiday-weeks/students/{studentId}/registration",
    {
      params: { studentId },
      errorMessage:
        "Die Angaben aus der Ferienanmeldung konnten nicht geladen werden",
    },
  );
  return entries.map((entry) => ({
    weekId: entry.week_id,
    periodName: entry.period_name,
    startsOn: day(entry.starts_on),
    endsOn: day(entry.ends_on),
    days: days(entry.days),
    timeModelName: entry.time_model_name,
    timeModelStartsAt: entry.time_model_starts_at,
    timeModelEndsAt: entry.time_model_ends_at,
    ...(entry.lunch ? { lunch: true } : {}),
    emergencyContacts: entry.emergency_contacts ?? [],
    pickupContacts: entry.pickup_contacts ?? [],
  }));
}

// ─── Feriengruppe vor ihrer Woche (#6680) ───────────────────────────────────

/** Die Feriengruppen der Schule, deren Woche noch nicht begonnen hat. */
export async function fetchHolidayGuestGroupHints(): Promise<
  HolidayGuestGroup[]
> {
  const today = berlinTodayISO();
  return (await fetchHolidayGuestGroups()).filter(
    (group) => group.startsOn > today,
  );
}

/**
 * Der Satz, mit dem eine leere Feriengruppe erklärt, warum sie leer ist.
 * Überall gleich: auf der Gruppenseite und im Check-in.
 */
export function holidayGuestGroupHintText(
  hint: Pick<HolidayGuestGroup, "startsOn" | "guests">,
): string {
  const day = formatDate(hint.startsOn);
  if (hint.guests === 0) {
    return `Feriengruppe ab ${day}: Noch ist kein Feriengast bestätigt.`;
  }
  return hint.guests === 1
    ? `Feriengruppe: 1 Kind kommt ab ${day} dazu.`
    : `Feriengruppe: ${hint.guests} Kinder kommen ab ${day} dazu.`;
}
