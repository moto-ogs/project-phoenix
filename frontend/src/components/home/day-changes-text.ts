/**
 * Die Texte von „Heute anders“ (#7659). Das Backend liefert nur Art,
 * Personen, Gruppe und Tage; hier entstehen die Sätze in einfacher Sprache.
 * Eine neue Quelle ergänzt ihre Arten in `DAY_CHANGE_TEXTS`, ihren Namen in
 * `SOURCE_FAILURE_TEXTS` und ihre Link-Ziele in `dayChangeHref`.
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

function closingDayText(change: DayChange): string {
  const closing = change.closing;
  const name = closing?.name.trim();
  if (!closing || !name) return "";
  return closing.traeger
    ? `Der Träger hat die OGS heute geschlossen: ${name}.`
    : `Die OGS ist heute geschlossen: ${name}.`;
}

/** Der Satz je Art. Eine unbekannte Art zeigt die Übersicht nicht. */
const DAY_CHANGE_TEXTS: Readonly<
  Record<string, (change: DayChange) => string>
> = {
  staff_absent: staffAbsentText,
  staff_absent_count: staffAbsentCountText,
  group_substitution: groupSubstitutionText,
  group_substitution_count: groupSubstitutionCountText,
  child_absent: childText,
  child_pickup_changed: childText,
  child_goes_alone: childText,
  child_pickup_note: childText,
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
  closing_day: closingDayText,
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
  staff: "Ausfälle und Vertretungen konnten gerade nicht geladen werden.",
  children:
    "Krankmeldungen und Abholzeiten der Kinder konnten gerade nicht geladen werden.",
  notices: "Hinweise der Leitung konnten gerade nicht geladen werden.",
  activities:
    "Änderungen an Angeboten und AGs konnten gerade nicht geladen werden.",
  closing_days: "Schließtage konnten gerade nicht geladen werden.",
};

export function sourceFailureText(source: string): string {
  return (
    SOURCE_FAILURE_TEXTS[source] ??
    "Ein Teil der Übersicht konnte gerade nicht geladen werden."
  );
}

/** Der Weg zur Detailseite eines Eintrags, ohne Schulpräfix. */
export function dayChangeHref(change: DayChange): string | null {
  return dayChangeLinkHref(change.link);
}

/** Der Weg zu einem Link-Ziel, auch für die Zeilen einer Zusammenfassung. */
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
    case "student":
      return link.studentId ? `/students/${link.studentId}` : null;
    case "staff_notices":
      return "/tagesinformationen";
    case "calendar_periods":
      return "/calendar-periods";
    case "day_plan":
      // Die Zeile ersetzt den Weg durch den Tagesplan der Person
      // (useDayPlanHref); das hier ist der Weg der Betreuung.
      return "/tagesplan";
    default:
      return null;
  }
}
