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
};

export function dayChangeText(change: DayChange): string | null {
  const text = DAY_CHANGE_TEXTS[change.kind]?.(change);
  // Ein Eintrag ohne Satz (etwa ein Kind ohne Daten) erscheint nicht.
  return text ? text : null;
}

/** „3.11.“ aus „2026-11-03“. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.`;
}

/** „seit 3.11.“, „bis 21.11.“ oder beides, sonst null. */
export function dayChangeSpan(change: DayChange): string | null {
  const parts: string[] = [];
  if (change.since) parts.push(`seit ${shortDay(change.since)}`);
  if (change.until) parts.push(`bis ${shortDay(change.until)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Der Hinweis, wenn eine Quelle gerade nicht geladen werden konnte. */
const SOURCE_FAILURE_TEXTS: Readonly<Record<string, string>> = {
  staff: "Ausfälle und Vertretungen konnten gerade nicht geladen werden.",
  children:
    "Krankmeldungen und Abholzeiten der Kinder konnten gerade nicht geladen werden.",
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
    default:
      return null;
  }
}
