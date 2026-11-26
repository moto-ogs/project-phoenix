/**
 * Die Texte von „Heute anders“ (#7659). Das Backend liefert nur Art,
 * Personen, Gruppe und Tage; hier entstehen die Sätze in einfacher Sprache.
 * Eine neue Quelle ergänzt ihre Arten in `DAY_CHANGE_TEXTS`, ihren Namen in
 * `SOURCE_FAILURE_TEXTS` und ihre Link-Ziele in `dayChangeLinkHref`.
 */
import type {
  DayChange,
  DayChangeChild,
  DayChangeChildSummary,
  DayChangeLink,
  DayChangePerson,
} from "~/lib/day-changes";
import { formatTime } from "~/lib/date-helpers";
import { schoolClassLabel } from "~/lib/school-class-label";

function personWith(
  change: DayChange,
  role: string,
): DayChangePerson | undefined {
  return change.people.find((person) => person.role === role);
}

function nameOf(person: DayChangePerson | undefined): string {
  return person?.name.trim() ? person.name : "Jemand aus dem Team";
}

function staffAbsentText(change: DayChange): string {
  const person = personWith(change, "absent");
  const when = change.halfDay ? "heute einen halben Tag" : "heute";
  if (person?.isSelf) return `Du bist ${when} nicht da.`;
  return `${nameOf(person)} ist ${when} nicht da.`;
}

function staffAbsentCountText(change: DayChange): string {
  const count = change.count ?? 0;
  return count === 1
    ? "1 weitere Person aus dem Team ist heute nicht da."
    : `${count} weitere Personen aus dem Team sind heute nicht da.`;
}

/**
 * Der Gruppenname mit Artikel: „die Gruppe Igel“, aber „die Sternengruppe“,
 * wenn der Name schon „gruppe“ enthält. `dative` für „in der …“.
 */
function groupPhrase(name: string | null, dative: boolean): string {
  const article = dative ? "der" : "die";
  if (!name) return dative ? "einer Gruppe" : "eine Gruppe";
  return /gruppe/i.test(name)
    ? `${article} ${name}`
    : `${article} Gruppe ${name}`;
}

function groupSubstitutionText(change: DayChange): string {
  const substitute = personWith(change, "substitute");
  const replaced = personWith(change, "replaced");
  const group = groupPhrase(change.groupName, false);
  const inGroup = `in ${groupPhrase(change.groupName, true)}`;
  if (substitute?.isSelf) {
    return replaced
      ? `Du vertrittst heute ${nameOf(replaced)} ${inGroup}.`
      : `Du vertrittst heute ${group}.`;
  }
  if (replaced?.isSelf) {
    return `${nameOf(substitute)} vertritt dich heute ${inGroup}.`;
  }
  return `${nameOf(substitute)} vertritt heute ${group}.`;
}

function groupSubstitutionCountText(change: DayChange): string {
  const count = change.count ?? 0;
  return count === 1
    ? "In 1 weiteren Gruppe vertritt heute jemand."
    : `In ${count} weiteren Gruppen vertritt heute jemand.`;
}

// Die Uhrzeit eines Dienstes steht nicht im Satz, sondern daneben
// (`dayChangeSpan`, #7660).
function shiftChangedText(change: DayChange): string {
  const person = personWith(change, "on_duty");
  return person?.isSelf
    ? "Dein Dienst ist heute anders."
    : `${nameOf(person)} hat heute einen anderen Dienst.`;
}

function shiftCancelledText(change: DayChange): string {
  const person = personWith(change, "on_duty");
  if (person?.isSelf) return "Dein Dienst fällt heute aus.";
  return `Der Dienst von ${nameOf(person)} fällt heute aus.`;
}

function shiftReplacementText(change: DayChange): string {
  const substitute = personWith(change, "substitute");
  const replaced = personWith(change, "replaced");
  if (substitute?.isSelf) {
    return replaced
      ? `Du vertrittst heute ${nameOf(replaced)}.`
      : "Du hast heute einen Dienst als Vertretung.";
  }
  if (replaced?.isSelf) {
    return `${nameOf(substitute)} vertritt dich heute.`;
  }
  return replaced
    ? `${nameOf(substitute)} vertritt heute ${nameOf(replaced)}.`
    : `${nameOf(substitute)} hat heute einen Dienst als Vertretung.`;
}

function childName(child: DayChangeChild): string {
  return child.name || "Ein Kind";
}

/** Der Satz zu einem Kind (#7665); der Grund steht nie dabei. */
const CHILD_TEXTS: Readonly<Record<string, (child: DayChangeChild) => string>> =
  {
    child_absent: (child) =>
      child.status === "sick"
        ? `${childName(child)} ist heute krank gemeldet.`
        : `${childName(child)} ist heute entschuldigt.`,
    child_pickup_changed: (child) =>
      child.pickupTime
        ? `${childName(child)} geht heute um ${child.pickupTime} Uhr.`
        : `${childName(child)} kommt heute nicht.`,
    child_goes_alone: (child) =>
      `${childName(child)} geht heute allein nach Hause.`,
    child_pickup_note: (child) =>
      `Hinweis zum Abholen von ${childName(child)}: ${child.note ?? ""}`,
    // Wer heute abholt (#7655); bei einer einmaligen Person den Ausweis prüfen.
    child_pickup_person: (child) =>
      child.pickupPerson
        ? `${child.pickupPerson.name} holt ${childName(child)} heute ab.${
            child.pickupPerson.oneTime ? " Bitte den Ausweis prüfen." : ""
          }`
        : `${childName(child)} wird heute von einer anderen Person abgeholt.`,
  };

export function childChangeText(
  kind: string,
  child: DayChangeChild,
): string | null {
  return CHILD_TEXTS[kind]?.(child) ?? null;
}

function childText(change: DayChange): string {
  return change.child ? (childChangeText(change.kind, change.child) ?? "") : "";
}

/** „Gruppe Igel“, „Sternengruppe“, „Klasse 4c“ oder „Ohne Gruppe“. */
export function childSummaryTitle(change: DayChange): string {
  const name = change.groupName;
  if (name) return /gruppe/i.test(name) ? name : `Gruppe ${name}`;
  return (
    schoolClassLabel(change.childSummary?.schoolClass ?? "") || "Ohne Gruppe"
  );
}

/** „4 krank, 1 geht allein“: nur die Zahlen, die es gibt. */
export function childSummaryCounts(summary: DayChangeChildSummary): string {
  const { sick, excused, pickupChanged, goesAlone, pickupNote } =
    summary.counts;
  const pickupPerson = summary.counts.pickupPerson ?? 0;
  const parts: string[] = [];
  if (sick > 0) parts.push(`${sick} krank`);
  if (excused > 0) parts.push(`${excused} entschuldigt`);
  if (pickupChanged > 0) {
    parts.push(`${pickupChanged} mit anderer Abholzeit`);
  }
  if (goesAlone > 0) {
    parts.push(`${goesAlone} ${goesAlone === 1 ? "geht" : "gehen"} allein`);
  }
  if (pickupNote > 0) {
    parts.push(
      `${pickupNote} ${pickupNote === 1 ? "Hinweis" : "Hinweise"} zum Abholen`,
    );
  }
  if (pickupPerson > 0) {
    parts.push(`${pickupPerson} mit anderer Abholperson`);
  }
  return parts.join(", ");
}

function childSummaryText(change: DayChange): string {
  if (!change.childSummary) return "";
  return `${childSummaryTitle(change)}: ${childSummaryCounts(change.childSummary)}`;
}

/** Der Termin in Anführungszeichen (#7662). */
function activityName(change: DayChange, sentenceStart: boolean): string {
  const title = change.activity?.title.trim();
  if (title) return `„${title}“`;
  return sentenceStart ? "Ein Termin" : "einem Termin";
}

/** „Anna“, „Anna und Ben“, „Anna, Ben und Clara“. */
function namesOf(people: readonly DayChangePerson[]): string {
  const names = people.map((person) => nameOf(person));
  if (names.length <= 1) return names[0] ?? nameOf(undefined);
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function activityLeadChangedText(change: DayChange): string {
  const name = activityName(change, false);
  // Ohne Namen: der Termin gehört anderen, und nur die Leitung sieht, wer
  // fehlt und wer übernimmt (#7662).
  if (change.people.length === 0) {
    return `Bei ${name} ändert sich heute, wer betreut.`;
  }
  const substitutes = change.people.filter(
    (person) => person.role === "substitute",
  );
  const absent = change.people.filter((person) => person.role === "absent");
  const meAbsent = absent.some((person) => person.isSelf);
  const others = absent.filter((person) => !person.isSelf);
  if (substitutes.some((person) => person.isSelf)) {
    return others.length > 0
      ? `Du übernimmst heute ${name} für ${namesOf(others)}.`
      : `Du übernimmst heute ${name}.`;
  }
  if (substitutes.length > 0) {
    const forWhom = meAbsent
      ? " für dich"
      : absent.length > 0
        ? ` für ${namesOf(absent)}`
        : "";
    const verb = substitutes.length === 1 ? "übernimmt" : "übernehmen";
    return `${namesOf(substitutes)} ${verb} heute ${name}${forWhom}.`;
  }
  if (meAbsent) return `Bei ${name} bist du heute nicht da.`;
  return absent.length === 1
    ? `Bei ${name} ist ${namesOf(absent)} heute nicht da.`
    : `Bei ${name} sind ${namesOf(absent)} heute nicht da.`;
}

/**
 * Abwesenheit oder Vertretung bei einem einzelnen Termin (#7675), aus der
 * Quelle Personal. Wer vertreten wird, heißt dort „replaced“; die Sätze sind
 * dieselben wie bei „andere Leitung“ aus dem Stundenplan.
 */
function blockStaffText(change: DayChange): string {
  return activityLeadChangedText({
    ...change,
    people: change.people.map((person) =>
      person.role === "replaced" ? { ...person, role: "absent" } : person,
    ),
  });
}

function blockChangeCountText(change: DayChange): string {
  const count = change.count ?? 0;
  return count === 1
    ? "Bei 1 weiteren Termin ändert sich heute, wer betreut."
    : `Bei ${count} weiteren Terminen ändert sich heute, wer betreut.`;
}

function closingDayText(change: DayChange): string {
  const closing = change.closing;
  const name = closing?.name.trim();
  if (!closing || !name) return "";
  return closing.traeger
    ? `Der Träger hat die OGS heute geschlossen: ${name}.`
    : `Die OGS ist heute geschlossen: ${name}.`;
}

/** „1 Kind aus Klasse 3a ist“, „12 Kinder aus Klasse 3a sind“ (#7681). */
function classChildren(change: DayChange): string {
  const count = change.schoolClass?.children ?? 0;
  const klass =
    schoolClassLabel(change.schoolClass?.name ?? "") || "einer Klasse";
  return count === 1
    ? `1 Kind aus ${klass} ist`
    : `${count} Kinder aus ${klass} sind`;
}

/** Ein Ausflug einer Klasse; nie ein Name oder ein Grund (#7681). */
function classTripText(change: DayChange): string {
  if (!change.schoolClass) return "";
  const time = change.schoolClass.time;
  return time
    ? `${classChildren(change)} heute auf Ausflug und ${change.schoolClass.children === 1 ? "kommt" : "kommen"} um ${time} Uhr zurück.`
    : `${classChildren(change)} heute den ganzen Tag unterwegs.`;
}

/** Ein geänderter Unterrichtsschluss einer Klasse (#7681). */
function classDismissalText(change: DayChange): string {
  const klass = schoolClassLabel(change.schoolClass?.name ?? "");
  const time = change.schoolClass?.time;
  if (!klass || !time) return "";
  return `Bei ${klass} endet der Unterricht heute um ${time} Uhr.`;
}

/** Der Titel eines Termins in Anführungszeichen, ohne Titel „Ein Termin“. */
function appointmentName(change: DayChange): string {
  const title = change.appointment?.title.trim();
  return title ? `„${title}“` : "Ein Termin";
}

function appointmentCancelledText(change: DayChange): string {
  return `${appointmentName(change)} fällt heute aus.`;
}

/**
 * Ein Termin heute an einem anderen Ort oder zu einer anderen Zeit (#7663).
 * Die neue Uhrzeit steht unter dem Satz, der neue Ort im Satz.
 */
function appointmentChangedText(change: DayChange): string {
  const name = appointmentName(change);
  const appointment = change.appointment;
  const location = appointment?.location?.trim();
  if (appointment?.locationChanged) {
    const where = location ? ` Neuer Ort: ${location}.` : "";
    return appointment.timeChanged
      ? `${name} ist heute zu einer anderen Zeit und an einem anderen Ort.${where}`
      : `${name} ist heute an einem anderen Ort.${where}`;
  }
  return `${name} ist heute zu einer anderen Zeit.`;
}

/** Das Mittagessen fällt heute aus, mit dem Grund der Schule (#7656). */
function mealCancelledText(change: DayChange): string {
  const reason = change.mealCancellation?.reason.trim().replace(/\.$/, "");
  return reason
    ? `Das Mittagessen fällt heute aus: ${reason}.`
    : "Das Mittagessen fällt heute aus.";
}

/** Der Satz je Art. Eine unbekannte Art zeigt die Übersicht nicht. */
const DAY_CHANGE_TEXTS: Readonly<
  Record<string, (change: DayChange) => string>
> = {
  staff_absent: staffAbsentText,
  staff_absent_count: staffAbsentCountText,
  group_substitution: groupSubstitutionText,
  group_substitution_count: groupSubstitutionCountText,
  shift_changed: shiftChangedText,
  shift_cancelled: shiftCancelledText,
  shift_replacement: shiftReplacementText,
  child_absent: childText,
  child_pickup_changed: childText,
  child_goes_alone: childText,
  child_pickup_note: childText,
  child_pickup_person: childText,
  child_summary: childSummaryText,
  // Der Hinweis der Leitung: sein Titel ist der Satz (#7667).
  staff_notice: (change) => change.notice?.title ?? "",
  // Termine aus dem Stundenplan (#7662).
  activity_cancelled: (change) =>
    `${activityName(change, true)} fällt heute aus.`,
  activity_reinstated: (change) =>
    `${activityName(change, true)} findet doch statt.`,
  activity_room_changed: (change) =>
    `${activityName(change, true)} ist heute in einem anderen Raum.`,
  activity_lead_changed: activityLeadChangedText,
  // Abwesenheit und Vertretung bei einem Termin (#7675).
  block_staff_absent: blockStaffText,
  block_substitution: blockStaffText,
  block_change_count: blockChangeCountText,
  closing_day: closingDayText,
  // Ausflug und Unterrichtsschluss einer Klasse (#7681).
  class_trip: classTripText,
  class_dismissal_changed: classDismissalText,
  // Termine aus dem eigenen Kalender (#7663).
  appointment_cancelled: appointmentCancelledText,
  appointment_changed: appointmentChangedText,
  // Nur die Kurzinfo (#7666); was es gibt, steht auf der Seite Speiseplan.
  meal_plan_changed: () => "Der Speiseplan für heute wurde geändert.",
  // Das Mittagessen fällt aus, obwohl die OGS offen ist (#7656).
  meal_cancelled: mealCancelledText,
};

export function dayChangeText(change: DayChange): string | null {
  // Ein leerer Satz (ein Hinweis ohne Titel, ein Kind ohne Daten) zählt wie
  // eine unbekannte Art.
  return DAY_CHANGE_TEXTS[change.kind]?.(change) || null;
}

/** „3.11.“ aus „2026-11-03“. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.`;
}

/**
 * Die Uhrzeit in der Zeitzone der Schule: „08:00 bis 09:30 Uhr“ oder
 * „ab 14:00 Uhr“, ohne Uhrzeit null.
 */
function timeOfDay(change: DayChange): string | null {
  if (!change.startsAt) return null;
  const start = formatTime(change.startsAt);
  return change.endsAt
    ? `${start} bis ${formatTime(change.endsAt)} Uhr`
    : `ab ${start} Uhr`;
}

/** Der Raum eines Termins, bei einem Wechsel „Turnhalle statt Werkraum“. */
function roomOf(change: DayChange): string | null {
  if (!change.roomName) return null;
  return change.previousRoomName
    ? `${change.roomName} statt ${change.previousRoomName}`
    : change.roomName;
}

/**
 * Wann: die Uhrzeit und „seit 3.11.“, „bis 21.11.“ oder beides, sonst null.
 * „Seit“ und „bis“ kommen aus der Antwort des Backends, nie aus einer
 * Rechnung hier (#7660).
 */
export function dayChangeSpan(change: DayChange): string | null {
  const parts: string[] = [];
  const time = timeOfDay(change);
  if (time) parts.push(time);
  const where = roomOf(change);
  if (where) parts.push(`· ${where}`);
  if (change.since) parts.push(`seit ${shortDay(change.since)}`);
  if (change.until) parts.push(`bis ${shortDay(change.until)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Der Hinweis, wenn eine Quelle gerade nicht geladen werden konnte. */
const SOURCE_FAILURE_TEXTS: Readonly<Record<string, string>> = {
  staff:
    "Ausfälle, Vertretungen und Dienste konnten gerade nicht geladen werden.",
  children:
    "Krankmeldungen, Abholzeiten und Ausflüge der Kinder konnten gerade nicht geladen werden.",
  notices: "Hinweise der Leitung konnten gerade nicht geladen werden.",
  activities:
    "Änderungen an Angeboten und AGs konnten gerade nicht geladen werden.",
  closing_days: "Schließtage konnten gerade nicht geladen werden.",
  classes:
    "Änderungen am Unterrichtsschluss der Klassen konnten gerade nicht geladen werden.",
  appointments: "Deine Termine konnten gerade nicht geladen werden.",
  meal_plan: "Änderungen am Speiseplan konnten gerade nicht geladen werden.",
  // Aufsichten in moto schule (#8148).
  supervisions:
    "Vertretungen bei deinen Aufsichten konnten gerade nicht geladen werden.",
};

export function sourceFailureText(source: string): string {
  return (
    SOURCE_FAILURE_TEXTS[source] ??
    "Ein Teil der Übersicht konnte gerade nicht geladen werden."
  );
}

/**
 * Der Weg zur Detailseite eines Link-Ziels, ohne Schulpräfix, auch für die
 * Zeilen einer Zusammenfassung. Die Karte liest ihn über `useDayChangeHref`.
 */
export function dayChangeLinkHref(link: DayChangeLink | null): string | null {
  if (!link) return null;
  switch (link.target) {
    case "staff_absences":
      return link.staffId ? `/staff/${link.staffId}?tab=abwesenheiten` : null;
    case "staff_member":
      return link.staffId ? `/staff/${link.staffId}` : null;
    case "own_absences":
      return "/time-tracking";
    case "staff_list":
      return "/staff";
    case "group_handovers":
      return "/substitutions";
    case "own_shift_plan":
      return "/mein-dienstplan";
    case "shift_plan":
      return link.staffId
        ? `/dienstplan?view=person&staff=${link.staffId}`
        : "/dienstplan";
    case "student":
      return link.studentId ? `/students/${link.studentId}` : null;
    case "staff_notices":
      return "/tagesinformationen";
    case "calendar_periods":
      return "/calendar-periods";
    case "substitution_plan":
      // Der Vertretungsplan des Tages mit dem Termin offen (#7675).
      return link.instanceId && link.day
        ? `/vertretung?d=${link.day}&block=${link.instanceId}`
        : "/vertretung";
    case "day_plan":
      // Die Zeile ersetzt den Weg durch den Tagesplan der Person
      // (useDayChangeHref); das hier ist der Weg der Betreuung.
      return "/tagesplan";
    case "calendar":
      return "/calendar";
    case "meal_plan":
      return "/meal-plan";
    default:
      return null;
  }
}
