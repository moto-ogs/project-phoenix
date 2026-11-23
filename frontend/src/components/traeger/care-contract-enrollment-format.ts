// Texte und Zustände für „Anmeldungen nachtragen“ (#7760, ADR 0309): der
// Stand einer Zeile, warum sie offen bleibt und wer etwas tun kann, die
// Buchungen in kurzer Form und die Zahlen nach einem Lauf. Reine Anzeige;
// jede Prüfung macht das Backend.

import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import type {
  EnrollmentBooking,
  EnrollmentCounts,
  EnrollmentReason,
  EnrollmentRow,
  EnrollmentWeekday,
} from "~/lib/traeger-contract-enrollments-api";
import { contractImportWeekdays } from "./care-contract-import-format";

/** „Anmeldung“ oder „Anmeldungen“ mit Zahl. */
export function enrollmentCount(count: number): string {
  return count === 1 ? "1 Anmeldung" : `${count} Anmeldungen`;
}

/** „1 Vertrag“, „12 Verträge“. */
export function enrollmentContractCount(count: number): string {
  return count === 1 ? "1 Vertrag" : `${count} Verträge`;
}

/** Der Name, „–“ ohne Namen. */
export function enrollmentName(person: {
  readonly firstName: string;
  readonly lastName: string;
}): string {
  const name = `${person.firstName} ${person.lastName}`.trim();
  return name === "" ? "–" : name;
}

interface StatusLabel {
  readonly label: string;
  readonly tone: StatusBadgeTone;
}

/**
 * Das Etikett einer Zeile. Nach einem Lauf sagt eine erledigte Zeile, was
 * der Lauf getan hat; vorher war sie schon gebunden.
 */
export function enrollmentStatus(row: EnrollmentRow): StatusLabel {
  switch (row.status) {
    case "ready":
      return { label: "Bereit", tone: "green" };
    case "done":
      if (row.action === "enroll")
        return { label: "Nachgetragen", tone: "green" };
      if (row.action === "bind") return { label: "Gebunden", tone: "green" };
      return { label: "Erledigt", tone: "gray" };
    case "unlinked":
      return { label: "Ohne Kinderakte", tone: "gray" };
    case "held":
      return { label: "Zurückgestellt", tone: "warning" };
    case "stuck":
      return { label: "Hängt", tone: "red" };
    case "changed":
      return { label: "Geändert", tone: "warning" };
    default:
      return { label: "–", tone: "gray" };
  }
}

/** Was eine Zeile ohne Bindung aufhält, in Gruppen für die Hilfe. */
const REASON_TEXTS: Record<EnrollmentReason, string> = {
  // Am Vertrag oder am Modul zu berichtigen.
  contract_not_active:
    "Der Vertrag ist nicht aktiv, zum Beispiel gekündigt. Für ihn trägt moto keine Anmeldung nach.",
  offering_gone:
    "Ein Modul des Vertrags ist kein Betreuungsangebot der Schule mehr. Ordne die Module des Vertrags neu zu.",
  two_phases:
    "Die Module des Vertrags gehören zu zwei Anmeldephasen. Ordne die Module so zu, dass sie in einer Phase liegen.",
  fixed_days:
    "Das Modul hat feste Wochentage, der Vertrag nennt andere. Berichtige die Wochentage im Vertrag.",
  day_unavailable:
    "Die Schule bietet das Modul an einem Wochentag des Vertrags nicht an. Berichtige die Wochentage im Vertrag.",
  end_time:
    "Die Endzeit im Vertrag ist eine andere als die des Moduls. Berichtige den Vertrag, sonst entstünde eine neue Vertragsversion.",
  bookings_differ:
    "Buchungen und Vertrag passen nicht zusammen. Prüfe die Wochentage und Module im Vertrag.",
  care_ends:
    "Der Vertrag verspricht Betreuung, die kein Modul abdeckt, zum Beispiel nach dem Ende des Moduls. Prüfe das Ende des Vertrags.",
  follows_contract:
    "Das Kind hat in dieser Phase schon einen früheren importierten Vertrag mit Anmeldung. Behandle diesen Vertrag als Änderung des früheren.",
  enrolled_elsewhere:
    "Für diesen Vertrag gibt es schon eine Anmeldung in einer anderen Anmeldephase. Ordne den Vertrag zurück auf ein Modul der Phase dieser Anmeldung.",
  // An der Schule zu klären.
  has_application:
    "Das Kind hat in dieser Phase schon eine andere Anmeldung, die nicht zum Vertrag passt. Kläre mit der Schule, welche Buchungen gelten.",
  offering_inactive:
    "Die Schule hat ein Modul des Vertrags ausgeschaltet. Die Schule schaltet es wieder ein, oder du berichtigst den Vertrag.",
  student_missing:
    "Die Schule hat diese Kinderakte nicht mehr. Prüfe die Verknüpfung des Vertrags.",
  student_inactive:
    "Die Kinderakte ist nicht mehr aktiv. Beende den Vertrag, oder die Schule nimmt das Kind wieder auf.",
  without_care_place:
    "Laut Kinderakte hat das Kind keinen Betreuungsplatz. Die Schule trägt den Platz in der Kinderakte ein.",
  birth_date_missing:
    "In der Kinderakte fehlt das Geburtsdatum. Die Schule trägt es ein.",
  care_ends_earlier:
    "In der Kinderakte endet die Betreuung früher als der Vertrag. Kläre mit der Schule, welches Ende stimmt.",
  care_offerings_off:
    "An dieser Schule sind Betreuungsangebote ausgeschaltet. Die Schule schaltet sie in ihren Einstellungen ein.",
  offering_phase:
    "Ein Modul gehört nicht zur Anmeldephase der Schule. Prüfe die Zuordnung der Module mit der Schule.",
  booking_window:
    "Die Buchungen liegen nicht im Zeitraum der Anmeldephase. Prüfe den Beginn des Vertrags.",
  phase_missing:
    "Die Anmeldephase gibt es an der Schule nicht mehr. Lade die Vorschau neu.",
  changed:
    "Die Anmeldung des Kindes hat sich seit der Prüfung geändert. Lade die Vorschau neu.",
  // Später von selbst.
  not_begun:
    "Der Vertrag hat noch nicht begonnen. Ab seinem ersten Tag nimmt ein neuer Lauf ihn mit.",
  phase_not_begun:
    "Die Betreuung der Anmeldephase hat noch nicht begonnen. Ab ihrem Beginn nimmt ein neuer Lauf den Vertrag mit.",
  phase_ended:
    "Die Betreuung der Anmeldephase ist vorbei. Für sie trägt moto keine Anmeldung mehr nach.",
  planned_change:
    "Der Vertrag hat eine geplante Änderung. Sobald sie gilt, nimmt ein neuer Lauf ihn mit.",
  window_too_short:
    "Bis zum Ende der Phase liegt kein gebuchter Wochentag mehr. Für diesen Vertrag ist nichts nachzutragen.",
};

const UNKNOWN_REASON =
  "moto kann für diesen Vertrag gerade keine Anmeldung nachtragen. Lade die Vorschau neu.";

/** Ein Grund in einem Satz: was nicht passt und wer etwas tun kann. */
export function enrollmentReasonText(row: EnrollmentRow): string {
  if (row.reason === "planned_change") {
    const from = row.changes[0]?.effectiveFrom;
    if (from) {
      return `Der Vertrag ändert sich ab ${formatDate(from)}. Ab dann nimmt ein neuer Lauf ihn mit.`;
    }
  }
  if (row.reason === "follows_contract" && row.followsContractId) {
    return `Das Kind hat in dieser Phase schon Vertrag Nr. ${row.followsContractId} mit Anmeldung. Behandle diesen Vertrag als Änderung von Nr. ${row.followsContractId}.`;
  }
  return row.reason ? REASON_TEXTS[row.reason] : UNKNOWN_REASON;
}

/**
 * Wie eine hängende Zeile wieder frei wird (ADR 0309 Abschnitt 4): Das Büro
 * berichtigt den Vertrag, oder die Schule die Buchungen der Anmeldung. Die
 * Anmeldung an der Schule zu beenden löst sie nicht.
 */
export const STUCK_WAY_OUT =
  "Die Schule hat aus einem früheren Lauf schon eine Anmeldung, aber der Vertrag passt nicht mehr dazu. Berichtige den Vertrag, oder die Schule berichtigt die Buchungen der Anmeldung. Dann bindet der nächste Lauf. Die Anmeldung an der Schule zu beenden hilft nicht.";

// Gründe, die bei einer hängenden Zeile nur sagen, dass die Anmeldung nicht
// mehr zum Vertrag passt: Das sagt der Satz zum Ausweg schon. Nur bei ihnen
// hilft es, Vertrag oder Buchungen zu berichtigen.
const STUCK_MISMATCH: ReadonlySet<EnrollmentReason | undefined> = new Set([
  "has_application",
  "bookings_differ",
  "changed",
  undefined,
]);

/** Vor jedem anderen Grund einer hängenden Zeile: was schon da ist. */
export const STUCK_HAS_ENROLLMENT =
  "Die Schule hat aus einem früheren Lauf schon eine Anmeldung. Der Vertrag ist noch nicht daran gebunden.";

/**
 * Der Vertrag wurde nach einem Lauf auf eine andere Anmeldephase umgestellt
 * (ADR 0309 Abschnitt 4): Buchungen zu ändern löst die Zeile dann nicht.
 */
export const STUCK_OTHER_PHASE =
  "Hast du die Module des Vertrags auf eine andere Anmeldephase umgestellt? Dann ordne sie zurück auf ein Modul der Phase dieser Anmeldung und hol eine neue Vorschau.";

const STUCK_PLANNED_CHANGE =
  "Die Schule hat aus einem früheren Lauf schon eine Anmeldung, aber sie kennt die geplante Änderung des Vertrags nicht. Die Schule bucht die Änderung nach, oder du berichtigst den Vertrag. Dann bindet der nächste Lauf. Liegt das neue Modul in einer anderen Anmeldephase, hilft nur, die Änderung im Vertrag zurückzunehmen.";

/**
 * Eine hängende Zeile (ADR 0309 Abschnitt 4): ihr Grund, wo er mehr sagt,
 * und der Ausweg. Ist die Phase vorbei, gibt es keinen Ausweg mehr.
 */
function stuckTexts(row: EnrollmentRow): string[] {
  if (row.reason === "phase_ended") {
    return [
      "Die Anmeldung aus einem früheren Lauf hat keinen Vertrag, und ihre Anmeldephase ist vorbei. Sie bleibt so an der Schule stehen. Ein zweiter Vertrag entsteht dafür nicht.",
    ];
  }
  if (row.reason === "planned_change") return [STUCK_PLANNED_CHANGE];
  // The planner cannot tell a contract moved to another phase from one whose
  // bookings differ: both arrive as `has_application`. Name both ways out.
  if (row.reason === "has_application") {
    return [STUCK_WAY_OUT, STUCK_OTHER_PHASE];
  }
  if (STUCK_MISMATCH.has(row.reason)) return [STUCK_WAY_OUT];
  // Ein anderer Grund (Kinderakte, Vertrag, Modul): Buchungen zu berichtigen
  // löst ihn nicht, nur der Grund selbst.
  return [STUCK_HAS_ENROLLMENT, enrollmentReasonText(row)];
}

/** Die Sätze einer Zeile: was moto tut oder getan hat, und was offen ist. */
export function enrollmentRowTexts(row: EnrollmentRow): string[] {
  switch (row.status) {
    case "ready":
      return row.action === "bind"
        ? [
            "Eine passende Anmeldung gibt es schon. moto bindet nur den Vertrag daran.",
          ]
        : row.action === "enroll"
          ? [
              "moto legt die Anmeldung mit dieser Betreuung an und bindet den Vertrag daran.",
            ]
          : [UNKNOWN_REASON];
    case "done":
      if (row.action === "enroll") {
        return ["Anmeldung eingetragen, Vertrag daran gebunden."];
      }
      if (row.action === "bind") {
        return ["Vertrag an die vorhandene Anmeldung gebunden."];
      }
      return [
        "Der Vertrag ist an die Anmeldung gebunden und folgt ihren Buchungen.",
      ];
    case "unlinked":
      return [
        "Der Vertrag ist mit keiner Kinderakte verknüpft. Verknüpfe ihn zuerst.",
      ];
    case "held":
      return [enrollmentReasonText(row)];
    case "stuck":
      return stuckTexts(row);
    case "changed":
      return [
        row.requestChildId
          ? "Der Vertrag ist nicht gebunden: Seit der Vorschau hat sich etwas geändert. An der Schule kann schon eine Anmeldung stehen. Lade die Vorschau neu. Sie zeigt, ob der nächste Lauf binden kann."
          : "Schule oder Vertrag haben sich seit der Vorschau geändert. moto hat nichts eingetragen. Lade die Vorschau neu.",
      ];
    default:
      return [UNKNOWN_REASON];
  }
}

/** Der letzte Tag einer halboffenen Buchung („bis 01.08.“ heißt „bis 31.07.“). */
function lastDay(validUntil: string): string {
  const day = parseISODate(validUntil);
  day.setDate(day.getDate() - 1);
  return toISODate(day);
}

/** „01.09.2026 bis 31.07.2027“, „ab 01.09.2026“ oder „“. */
export function enrollmentBookingPeriod(booking: EnrollmentBooking): string {
  if (!booking.validFrom) return "";
  const from = formatDate(booking.validFrom);
  return booking.validUntil
    ? `${from} bis ${formatDate(lastDay(booking.validUntil))}`
    : `ab ${from}`;
}

/**
 * Wochentage mit Endzeit: „Mo–Fr bis 15:00“; weichen Endzeiten ab, je
 * Gruppe gleicher Zeit („Mo–Do bis 15:00, Fr bis 13:00“).
 */
export function enrollmentBookingDays(booking: EnrollmentBooking): string {
  if (booking.days.length === 0) return "–";
  const byTime = new Map<string, EnrollmentWeekday[]>();
  for (const day of booking.days) {
    const time = booking.endTimes[day] ?? "";
    byTime.set(time, [...(byTime.get(time) ?? []), day]);
  }
  return [...byTime.entries()]
    .map(([time, days]) => {
      const names = contractImportWeekdays(days);
      return time ? `${names} bis ${time}` : names;
    })
    .join(", ");
}

/** Filter der Tabelle; „open“ sind die Zeilen, an denen jemand etwas tun muss. */
export type EnrollmentFilter =
  "all" | "ready" | "done" | "open" | "stuck" | "unlinked";

export function matchesEnrollmentFilter(
  row: EnrollmentRow,
  filter: EnrollmentFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return row.status === "held" || row.status === "changed";
    default:
      return row.status === filter;
  }
}

/** Zeilen, die offen bleiben: zurückgehalten, geändert oder hängend. */
export function openEnrollmentCount(counts: EnrollmentCounts): number {
  return counts.held + counts.changed + counts.stuck;
}

/**
 * Der Filter, mit dem die Tabelle öffnet. Vor dem Lauf zeigt sie, was
 * passieren wird; danach, was offen bleibt.
 */
export function defaultEnrollmentFilter(
  counts: EnrollmentCounts,
  afterRun: boolean,
): EnrollmentFilter {
  if (!afterRun && counts.ready > 0) return "ready";
  if (counts.stuck > 0) return "stuck";
  if (counts.held + counts.changed > 0) return "open";
  return "all";
}

/** Was ein Lauf getan hat, gezählt nach seinen Zeilen. */
export interface EnrollmentRunSummary {
  /** Anmeldung eingetragen und Vertrag gebunden. */
  readonly enrolled: number;
  /** Vertrag an eine vorhandene Anmeldung gebunden. */
  readonly bound: number;
  /** Schon vor dem Lauf gebunden. */
  readonly alreadyDone: number;
  /** Offen geblieben: zurückgehalten, hängend, geändert oder ohne Kinderakte. */
  readonly open: number;
}

export function enrollmentRunSummary(
  rows: readonly EnrollmentRow[],
): EnrollmentRunSummary {
  let enrolled = 0;
  let bound = 0;
  let alreadyDone = 0;
  let open = 0;
  for (const row of rows) {
    if (row.status === "done") {
      if (row.action === "enroll") enrolled++;
      else if (row.action === "bind") bound++;
      else alreadyDone++;
    } else {
      open++;
    }
  }
  return { enrolled, bound, alreadyDone, open };
}
