/**
 * Die Texte von „Heute anders“ (#7659). Das Backend liefert nur Art,
 * Personen, Gruppe und Tage; hier entstehen die Sätze in einfacher Sprache.
 * Eine neue Quelle ergänzt ihre Arten in `DAY_CHANGE_TEXTS`, ihren Namen in
 * `SOURCE_FAILURE_TEXTS` und ihre Link-Ziele in `dayChangeHref`.
 */
import { formatTime } from "~/lib/date-helpers";
import type { DayChange, DayChangePerson } from "~/lib/day-changes";

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

/** „12:00 bis 16:00 Uhr“ für einen Dienst mit Uhrzeit, sonst null. */
function shiftClock(change: DayChange): string | null {
  if (!change.startsAt || !change.endsAt) return null;
  return `${formatTime(change.startsAt)} bis ${formatTime(change.endsAt)} Uhr`;
}

/** „ von 12:00 bis 16:00 Uhr“ für einen Satz, sonst leer. */
function shiftTime(change: DayChange): string {
  const clock = shiftClock(change);
  return clock ? ` von ${clock}` : "";
}

function shiftChangedText(change: DayChange): string {
  const person = personWith(change, "on_duty");
  const clock = shiftClock(change);
  const sentence = person?.isSelf
    ? "Dein Dienst ist heute anders"
    : `${nameOf(person)} hat heute einen anderen Dienst`;
  return clock ? `${sentence}: ${clock}.` : `${sentence}.`;
}

function shiftCancelledText(change: DayChange): string {
  const person = personWith(change, "on_duty");
  const time = shiftTime(change);
  if (person?.isSelf) return `Dein Dienst${time} fällt heute aus.`;
  return `Der Dienst von ${nameOf(person)}${time} fällt heute aus.`;
}

function shiftReplacementText(change: DayChange): string {
  const substitute = personWith(change, "substitute");
  const replaced = personWith(change, "replaced");
  const time = shiftTime(change);
  if (substitute?.isSelf) {
    return replaced
      ? `Du vertrittst heute ${nameOf(replaced)}${time}.`
      : `Du hast heute einen Dienst als Vertretung${time}.`;
  }
  if (replaced?.isSelf) {
    return `${nameOf(substitute)} vertritt dich heute${time}.`;
  }
  return replaced
    ? `${nameOf(substitute)} vertritt heute ${nameOf(replaced)}${time}.`
    : `${nameOf(substitute)} hat heute einen Dienst als Vertretung${time}.`;
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
};

export function dayChangeText(change: DayChange): string | null {
  return DAY_CHANGE_TEXTS[change.kind]?.(change) ?? null;
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
  staff:
    "Ausfälle, Vertretungen und Dienste konnten gerade nicht geladen werden.",
};

export function sourceFailureText(source: string): string {
  return (
    SOURCE_FAILURE_TEXTS[source] ??
    "Ein Teil der Übersicht konnte gerade nicht geladen werden."
  );
}

/** Der Weg zur Detailseite eines Eintrags, ohne Schulpräfix. */
export function dayChangeHref(change: DayChange): string | null {
  const link = change.link;
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
    default:
      return null;
  }
}
