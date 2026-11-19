// Sammelzuordnung einer Arbeitszeitmodell-Vorlage (#6921): wer die Vorlage
// schon nutzt, wer sie bekommen kann und warum jemand gerade nicht wählbar
// ist. Das Backend prüft dieselben Regeln noch einmal; hier stehen sie, damit
// der Dialog den Grund an der Person zeigt, bevor jemand speichert.

import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { positionForForm } from "~/lib/position-title";
import type { Staff, StaffWorkTimeFact, WorkTimeModel } from "~/lib/staff-api";

export interface AssignmentPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
  readonly avatarUrl: string | null;
  /** Woher das Soll heute kommt, als kurzer Satzteil. */
  readonly current: string;
  readonly hasSchedule: boolean;
  readonly keptByTraeger: boolean;
  /** Letzter abgeschlossener Monat („YYYY-MM“) oder `null`. */
  readonly closedThrough: string | null;
}

export interface AssignmentPeople {
  /** Nutzen die Vorlage schon. */
  readonly assignees: readonly AssignmentPerson[];
  /** Können sie bekommen oder sehen hier, warum nicht. */
  readonly candidates: readonly AssignmentPerson[];
}

/**
 * Teilt die Personen der Schule auf. Externe Kräfte führen kein Soll in moto
 * und stehen deshalb nicht zur Wahl.
 */
export function assignmentPeople(
  staff: readonly Staff[],
  facts: readonly StaffWorkTimeFact[],
  models: readonly WorkTimeModel[],
  modelId: string,
): AssignmentPeople {
  const factByStaff = new Map(facts.map((fact) => [fact.staffId, fact]));
  const modelName = new Map(models.map((model) => [model.id, model.name]));
  const assignees: AssignmentPerson[] = [];
  const candidates: AssignmentPerson[] = [];
  for (const member of staff) {
    if (member.isExternal) continue;
    const fact = factByStaff.get(member.id);
    const person: AssignmentPerson = {
      id: member.id,
      name: member.name || `${member.firstName} ${member.lastName}`.trim(),
      role: member.role?.trim()
        ? positionForForm(member.role.trim(), member.roleForm)
        : null,
      avatarUrl: member.avatarUrl ?? null,
      current: currentSoll(fact, modelName),
      hasSchedule: fact?.hasSchedule ?? false,
      keptByTraeger: fact?.sollKeptByTraeger ?? false,
      closedThrough: fact?.closedThrough ?? null,
    };
    if (fact?.workTimeModelId === modelId) assignees.push(person);
    else candidates.push(person);
  }
  const byName = (a: AssignmentPerson, b: AssignmentPerson) =>
    a.name.localeCompare(b.name, "de");
  return {
    assignees: assignees.sort(byName),
    candidates: candidates.sort(byName),
  };
}

function currentSoll(
  fact: StaffWorkTimeFact | undefined,
  modelName: ReadonlyMap<string, string>,
): string {
  if (fact?.sollKeptByTraeger) return "Soll vom Träger";
  if (fact?.workTimeModelId) {
    const name = modelName.get(fact.workTimeModelId);
    return name ? `Vorlage „${name}“` : "Andere Vorlage";
  }
  if (fact?.hasSchedule) return "Eigenes Soll";
  return "Noch kein Soll";
}

/** „September 2026“ aus „2026-09“. */
function monthLabel(month: string): string {
  return parseISODate(`${month}-01`).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Warum die Person mit diesem Start nicht wählbar ist, oder `null`.
 * `validFrom` ist `null` für „ab heute“.
 */
export function blockedReason(
  person: AssignmentPerson,
  validFrom: string | null,
): string | null {
  if (person.keptByTraeger) {
    return "Das Soll legt der Träger fest. Die Schule kann es nicht ändern.";
  }
  if (validFrom === null) return null;
  if (person.hasSchedule) {
    return "Hat schon ein Soll. Früher beginnen geht nur beim ersten Soll.";
  }
  if (person.closedThrough && validFrom.slice(0, 7) <= person.closedThrough) {
    return `Bis ${monthLabel(person.closedThrough)} ist der Monat abgeschlossen.`;
  }
  return null;
}

/**
 * Vorschlag für „Früheres Datum“: der Erste des laufenden Monats, am Ersten
 * selbst der Erste des Vormonats.
 */
export function suggestedEarlierStart(today: string): string {
  const day = parseISODate(today);
  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  if (toISODate(first) === today) first.setMonth(first.getMonth() - 1);
  return toISODate(first);
}

/** Der Tag vor `today`: der späteste Tag, der noch „früher“ ist. */
export function dayBefore(today: string): string {
  const day = parseISODate(today);
  day.setDate(day.getDate() - 1);
  return toISODate(day);
}

/** „ab heute“ oder „ab dem 01.09.2026“, für Zusammenfassung und Erfolg. */
export function startPhrase(validFrom: string | null, today: string): string {
  return validFrom === null || validFrom === today
    ? "ab heute"
    : `ab dem ${formatDate(validFrom)}`;
}

export function peopleCount(count: number): string {
  return count === 1 ? "1 Person" : `${count} Personen`;
}
