// Client-side API für "Betreuung beenden" (#2487).
//
// Ein regulärer Austritt ist keine Datenlöschung: Er setzt einen letzten
// Betreuungstag, beendet ab dem Folgetag alle laufenden Wirkungen und lässt
// die Historie unverändert stehen. Die endgültige Löschung (student-api.ts)
// bleibt daneben bestehen und ist strenger geschützt.

import { bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import { knownEnum } from "./contract/known-enum";

const CARE_EXIT_REASONS = ["moved_away", "no_care_needed", "other"] as const;

/** Austrittsgründe. Nur "other" trägt einen Freitext. */
export type CareExitReason = (typeof CARE_EXIT_REASONS)[number];

export const CARE_EXIT_REASON_LABELS: Record<CareExitReason, string> = {
  moved_away: "Umzug",
  no_care_needed: "Kein Betreuungsbedarf mehr",
  other: "Anderer Grund",
};

/** Maximale Länge des Freitexts bei "Anderer Grund". */
export const CARE_EXIT_NOTE_MAX_LENGTH = 200;

/** Auswirkungen für ein Kind, so wie die Vorschau sie meldet. */
export interface CareExitImpact {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  /** Geplante Termine nach dem letzten Betreuungstag, die das Kind verliert. */
  plannedRosterRows: number;
  /** Angebots- und AG-Buchungen, die am letzten Betreuungstag enden. */
  activityBookings: number;
  /** Offene Eltern-Anfragen, die mit dem Austritt geschlossen werden. */
  openParentRequests: number;
  hasRfidTag: boolean;
  currentlyPresent: boolean;
  sourceOfferings: Array<{ name: string; days: string[] }>;
  weeklyPlans: string[];
  /** Bereits hinterlegtes Betreuungsende (dann ist der Vorgang eine Änderung). */
  plannedEndsOn: string | null;
  /** Leer, wenn das Kind beendet werden kann; sonst der konkrete Grund. */
  blocker: string;
}

export interface CareExitPreview {
  /** Unveränderbarer Vorschau-Stand, den die Bestätigung zurückgeben muss. */
  token: string;
  lastCareDay: string;
  reason: CareExitReason;
  reasonNote: string;
  /** true, sobald mindestens ein Kind einen Blocker hat. */
  blocked: boolean;
  students: CareExitImpact[];
}

export interface CareExitResult {
  studentsEnded: number;
  rosterRowsRemoved: number;
  bookingsEnded: number;
}

export interface EndedCareEntry {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  lastCareDay: string;
  reason: CareExitReason | null;
  reasonNote: string | null;
  recordedAt: string | null;
}

export interface EndedCarePage {
  items: EndedCareEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CareExitInput {
  studentIds: string[];
  lastCareDay: string;
  reason: CareExitReason;
  reasonNote?: string;
}

// Code, Feldfehler und Vorgangskennung reisen im ApiError weiter (#2513,
// ADR 0006); die Meldung des Backends steht in dessen `detail`.
const errorMessage = "Betreuung beenden: Anfrage fehlgeschlagen";

/** Grund, Freitext und Vorschau-Stand; die Kinder nennt der Aufrufer. */
function toWireExit(
  input: CareExitInput,
  token?: string,
): studentsContract.careWithdrawalExitRequest {
  return {
    last_care_day: input.lastCareDay,
    reason: input.reason,
    // Nur "Anderer Grund" trägt einen Freitext; das Backend weist eine
    // Kombination aus kategorisiertem Grund und Freitext ab.
    reason_note: input.reason === "other" ? (input.reasonNote ?? "") : "",
    ...(token !== undefined && { token }),
  };
}

function toWireInput(
  input: CareExitInput,
  token?: string,
): studentsContract.careExitRequest {
  return { student_ids: input.studentIds, ...toWireExit(input, token) };
}

function mapImpact(
  wire: studentsContract.careExitImpactResponse,
): CareExitImpact {
  return {
    studentId: wire.student_id,
    firstName: wire.first_name,
    lastName: wire.last_name,
    schoolClass: wire.school_class ?? "",
    plannedRosterRows: wire.planned_roster_rows,
    activityBookings: wire.activity_bookings,
    openParentRequests: wire.open_parent_requests,
    hasRfidTag: wire.has_rfid_tag,
    currentlyPresent: wire.currently_present,
    sourceOfferings: (wire.source_offerings ?? []).map((offering) => ({
      name: offering.name,
      days: offering.days ?? [],
    })),
    weeklyPlans: wire.weekly_plans ?? [],
    plannedEndsOn: wire.planned_ends_on ?? null,
    blocker: wire.blocker ?? "",
  };
}

export interface CareWithdrawalCompletion {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  firstBookinglessDay: string;
  urgency: "planned" | "overdue";
  state: "pending" | "resolved";
  outcome?: "care_ended" | "deleted";
  resolvedAt?: string;
}

export interface CareWithdrawalPage {
  items: CareWithdrawalCompletion[];
  total: number;
  page: number;
  pageSize: number;
}

function mapPreview(
  wire: studentsContract.careExitPreviewResponse,
): CareExitPreview {
  return {
    token: wire.token,
    lastCareDay: wire.last_care_day,
    // Die Vorschau nennt den Grund der Anfrage; einen unbekannten liest
    // diese Version als "Anderer Grund".
    reason: knownEnum(CARE_EXIT_REASONS, wire.reason) ?? "other",
    reasonNote: wire.reason_note ?? "",
    blocked: wire.blocked,
    students: (wire.students ?? []).map(mapImpact),
  };
}

function mapResult(
  wire: studentsContract.careExitConfirmedResponse,
): CareExitResult {
  return {
    studentsEnded: wire.students_ended,
    rosterRowsRemoved: wire.roster_rows_removed,
    bookingsEnded: wire.bookings_ended,
  };
}

const WITHDRAWAL_URGENCIES = ["planned", "overdue"] as const;
const WITHDRAWAL_STATES = ["pending", "resolved"] as const;
const WITHDRAWAL_OUTCOMES = ["care_ended", "deleted"] as const;

function mapCareWithdrawal(
  wire: studentsContract.careWithdrawalResponse,
): CareWithdrawalCompletion {
  return {
    id: wire.id,
    studentId: wire.student_id ?? "",
    firstName: wire.first_name ?? "",
    lastName: wire.last_name ?? "",
    schoolClass: wire.school_class ?? "",
    firstBookinglessDay: wire.first_bookingless_day,
    // Eine Dringlichkeit, die diese Version nicht kennt, gilt als geplant.
    urgency: knownEnum(WITHDRAWAL_URGENCIES, wire.urgency) ?? "planned",
    state: knownEnum(WITHDRAWAL_STATES, wire.state) ?? "pending",
    outcome: knownEnum(WITHDRAWAL_OUTCOMES, wire.outcome),
    resolvedAt: wire.resolved_at,
  };
}

export async function fetchCareWithdrawals(
  params: {
    search?: string;
    studentId?: string;
    page?: number;
    pageSize?: number;
    state?: "pending" | "resolved";
  } = {},
): Promise<CareWithdrawalPage> {
  return mapCareWithdrawalPage(
    await bffJson("tenant", "GET /api/students/care-withdrawals", {
      query: {
        search: params.search || undefined,
        student_id: params.studentId || undefined,
        page: params.page || undefined,
        page_size: params.pageSize || undefined,
        state: params.state,
      },
      errorMessage,
    }),
  );
}

export function mapCareWithdrawalPage(
  wire: studentsContract.careWithdrawalPageResponse,
): CareWithdrawalPage {
  return {
    items: (wire.items ?? []).map(mapCareWithdrawal),
    total: wire.total,
    page: wire.page,
    pageSize: wire.page_size,
  };
}

/**
 * Die abgeschlossenen Abmeldungen eines Kindes, seitenweise (#5025). Die
 * Route verlangt users:update oder users:absence und Lesezugriff auf das Kind,
 * nicht users:delete wie die Liste der Schule; sie kennt weder Suche noch
 * offene Abmeldungen.
 */
export async function fetchStudentCareWithdrawalHistory(
  studentId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<CareWithdrawalPage> {
  return mapCareWithdrawalPage(
    await bffJson("tenant", "GET /api/students/{id}/care-withdrawals", {
      params: { id: studentId },
      query: {
        page: params.page || undefined,
        page_size: params.pageSize || undefined,
      },
      errorMessage,
    }),
  );
}

export async function fetchStudentCareWithdrawal(
  studentId: string,
): Promise<CareWithdrawalCompletion | null> {
  const page = await fetchCareWithdrawals({ studentId, pageSize: 1 });
  return page.items[0] ?? null;
}

export async function previewWithdrawalCareEnd(
  completionId: string,
  input: CareExitInput,
): Promise<CareExitPreview> {
  return mapPreview(
    await bffJson(
      "tenant",
      "POST /api/students/care-withdrawals/{completionId}/care-end/preview",
      { params: { completionId }, body: toWireExit(input), errorMessage },
    ),
  );
}

export async function confirmWithdrawalCareEnd(
  completionId: string,
  token: string,
  input: CareExitInput,
): Promise<CareExitResult> {
  return mapResult(
    await bffJson(
      "tenant",
      "POST /api/students/care-withdrawals/{completionId}/care-end",
      {
        params: { completionId },
        body: toWireExit(input, token),
        errorMessage,
      },
    ),
  );
}

/** Fragt, was das Beenden bewirken würde. Ändert nichts. */
export async function previewCareExit(
  input: CareExitInput,
): Promise<CareExitPreview> {
  return mapPreview(
    await bffJson("tenant", "POST /api/students/care-end/preview", {
      body: toWireInput(input),
      errorMessage,
    }),
  );
}

/**
 * Beendet die Betreuung für genau den Vorschau-Stand. Hat sich seither etwas
 * geändert, wird nichts geschrieben und das Backend nennt den Grund.
 */
export async function confirmCareExit(
  token: string,
  input: CareExitInput,
): Promise<CareExitResult> {
  return mapResult(
    await bffJson("tenant", "POST /api/students/care-end", {
      body: toWireInput(input, token),
      errorMessage,
    }),
  );
}

/** Storniert ein noch nicht wirksames Betreuungsende. */
export async function cancelCareExit(studentIds: string[]): Promise<number> {
  const data = await bffJson("tenant", "POST /api/students/care-end/cancel", {
    body: { student_ids: studentIds },
    errorMessage,
  });
  return data.students_cancelled;
}

/**
 * Nimmt die Betreuung eines Kindes wieder auf. `checked` ist die ausdrückliche
 * Bestätigung, dass Gruppe, Angebote, Wochenplan sowie Ankunfts- und Gehzeiten
 * geprüft wurden — nichts wird automatisch wieder eingeschaltet.
 */
export async function resumeCare(
  studentId: string,
  newStart: string,
  checked: boolean,
): Promise<void> {
  await bffJson("tenant", "POST /api/students/{id}/care-end/resume", {
    params: { id: studentId },
    body: { new_start: newStart, checked },
    errorMessage,
  });
}

/** Lädt die Ansicht "Beendete Betreuungen". */
export async function fetchEndedCare(params: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<EndedCarePage> {
  const data = await bffJson("tenant", "GET /api/students/ended-care", {
    query: {
      search: params.search || undefined,
      page: params.page || undefined,
      page_size: params.pageSize || undefined,
    },
    errorMessage,
  });
  return mapEndedCarePage(data);
}

export const ENDED_CARE_PAGE_SIZE = 50;

export function mapEndedCarePage(
  data: studentsContract.endedCarePageResponse,
): EndedCarePage {
  return {
    items: (data.items ?? []).map((wire) => ({
      studentId: wire.student_id,
      firstName: wire.first_name,
      lastName: wire.last_name,
      schoolClass: wire.school_class ?? "",
      lastCareDay: wire.last_care_day,
      reason: knownEnum(CARE_EXIT_REASONS, wire.reason) ?? null,
      reasonNote: wire.reason_note ?? null,
      recordedAt: wire.recorded_at ?? null,
    })),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
  };
}

/**
 * Ist für dieses Kind ein Austritt hinterlegt, der noch nicht gegriffen hat?
 *
 * Entscheidend ist, ob die Schule das Ende eingetragen hat, nicht wie weit es
 * entfernt liegt: Ein Ende Monate voraus ist in aller Regel das reguläre Ende
 * der Anmeldephase (in der Demo-Schule tragen alle über die Anmeldung
 * erfassten Kinder denselben Tag im übernächsten Sommer). Nur ein
 * eingetragener Austritt bekommt den Hinweis in der Liste und die Knöpfe
 * "Ende ändern" und "Ende stornieren" — und der bekommt sie immer, sonst
 * ließe sich ein früh geplanter Austritt nicht mehr zurücknehmen.
 */
export function hasPlannedCareExit(
  student: Partial<
    Pick<
      studentsContract.StudentResponse,
      "care_ends_on" | "care_ended" | "care_exit_recorded"
    >
  >,
): boolean {
  return Boolean(
    student.care_exit_recorded && student.care_ends_on && !student.care_ended,
  );
}

/**
 * Darf die Betreuung dieses Kindes wieder aufgenommen werden?
 *
 * Zurücknehmen lässt sich nur ein hinterlegter Austritt. Kinder, deren
 * Betreuung schlicht mit der Anmeldephase auslief, haben keinen Austritt und
 * werden vom Server mit „Für dieses Kind ist keine beendete Betreuung
 * hinterlegt.“ abgewiesen. Ein Knopf, der immer scheitert, gehört nicht auf
 * den Bildschirm (#2487).
 */
export function canResumeCare(
  student: Partial<
    Pick<studentsContract.StudentResponse, "care_ended" | "care_exit_recorded">
  >,
): boolean {
  return Boolean(student.care_ended && student.care_exit_recorded);
}
