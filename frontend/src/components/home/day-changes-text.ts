/**
 * Die Texte von „Heute anders“ (#7659). Das Backend liefert nur Art,
 * Personen, Gruppe und Tage; hier entstehen die Sätze in einfacher Sprache.
 * Eine neue Quelle ergänzt ihre Arten in `DAY_CHANGE_TEXTS`, ihren Namen in
 * `SOURCE_FAILURE_TEXTS` und ihre Link-Ziele in `dayChangeHref`.
 */
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

/** Der Termin in Anführungszeichen, „Ein Termin“ ohne Titel (#7662). */
function activityName(change: DayChange): string {
  const title = change.activity?.title.trim();
  return title ? `„${title}“` : "Ein Termin";
}

function activityNameInSentence(change: DayChange): string {
  const title = change.activity?.title.trim();
  return title ? `„${title}“` : "einen Termin";
}

/** „Anna“, „Anna und Ben“, „Anna, Ben und Clara“. */
function namesOf(people: readonly DayChangePerson[]): string {
  const names = people.map((person) => nameOf(person));
  if (names.length <= 1) return names[0] ?? nameOf(undefined);
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function activityCancelledText(change: DayChange): string {
  return `${activityName(change)} fällt heute aus.`;
}

function activityReinstatedText(change: DayChange): string {
  return `${activityName(change)} findet doch statt.`;
}

function activityRoomChangedText(change: DayChange): string {
  return `${activityName(change)} ist heute in einem anderen Raum.`;
}

function activityLeadChangedText(change: DayChange): string {
  const substitutes = change.people.filter(
    (person) => person.role === "substitute",
  );
  const absent = change.people.filter((person) => person.role === "absent");
  const name = activityNameInSentence(change);
  // Ohne Namen: der Termin gehört anderen, und nur die Leitung sieht, wer
  // fehlt und wer übernimmt (#7662).
  if (change.people.length === 0) {
    return `Bei ${name} ändert sich heute, wer betreut.`;
  }
  const meSubstitute = substitutes.some((person) => person.isSelf);
  const meAbsent = absent.some((person) => person.isSelf);
  const others = absent.filter((person) => !person.isSelf);
  if (meSubstitute) {
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
    return `${namesOf(substitutes)} übernimmt heute ${name}${forWhom}.`;
  }
  if (meAbsent) return `Bei ${name} bist du heute nicht da.`;
  return absent.length === 1
    ? `Bei ${name} ist ${namesOf(absent)} heute nicht da.`
    : `Bei ${name} sind ${namesOf(absent)} heute nicht da.`;
}

/** Der Satz je Art. Eine unbekannte Art zeigt die Übersicht nicht. */
const DAY_CHANGE_TEXTS: Readonly<
  Record<string, (change: DayChange) => string>
> = {
  staff_absent: staffAbsentText,
  staff_absent_count: staffAbsentCountText,
  group_substitution: groupSubstitutionText,
  group_substitution_count: groupSubstitutionCountText,
  activity_cancelled: activityCancelledText,
  activity_reinstated: activityReinstatedText,
  activity_room_changed: activityRoomChangedText,
  activity_lead_changed: activityLeadChangedText,
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

/**
 * Uhrzeit und Raum eines Termins (#7662): „13:00–14:00 · Aula“, bei einem
 * Raumwechsel „14:00–15:00 · Turnhalle statt Werkraum“. Sonst null.
 */
export function dayChangeWhenWhere(change: DayChange): string | null {
  if (!change.activity) return null;
  const parts = [`${change.activity.startTime}–${change.activity.endTime}`];
  if (change.roomName && change.previousRoomName) {
    parts.push(`${change.roomName} statt ${change.previousRoomName}`);
  } else if (change.roomName) {
    parts.push(change.roomName);
  }
  return parts.join(" · ");
}

/** Der Hinweis, wenn eine Quelle gerade nicht geladen werden konnte. */
const SOURCE_FAILURE_TEXTS: Readonly<Record<string, string>> = {
  staff: "Ausfälle und Vertretungen konnten gerade nicht geladen werden.",
  activities:
    "Änderungen an Angeboten und AGs konnten gerade nicht geladen werden.",
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
    case "day_plan":
      // Die Zeile ersetzt den Weg durch den Tagesplan der Person
      // (useDayPlanHref); das hier ist der Weg der Betreuung.
      return "/tagesplan";
    default:
      return null;
  }
}
