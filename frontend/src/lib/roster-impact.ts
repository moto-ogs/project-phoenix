/**
 * Auswirkung einer Buchungsänderung auf die Regeltermine eines Kindes (#5102).
 *
 * Das Backend rechnet sie beim Speichern aus und liefert sie in der Antwort
 * mit: welche Regeltermine automatisch angepasst wurden und welche das Kind an
 * weggefallenen Wochentagen weiter einplanen, weil sie von Hand gepflegt
 * werden. Die Oberflächen zeigen sie nur an.
 */
import { bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";
import type * as traegerContractChangesContract from "~/lib/contract/traeger-contract-changes.generated";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";

export interface AdjustedRosterTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly removedWeekdays: readonly number[];
  readonly addedWeekdays: readonly number[];
}

export interface ManualRosterTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly weekdays: readonly number[];
  /** Klasse, Jahrgang oder Gruppe nimmt das Kind in neue Termine wieder auf. */
  readonly viaTarget: boolean;
  /**
   * Ab diesem Tag deckt eine spätere Buchung den Regeltermin wieder ab
   * (YYYY-MM-DD, exklusives Ende, #5497); null, wenn keine das tut.
   * „Entfernen“ endet dort.
   */
  readonly until: string | null;
}

/**
 * Ein Wochentag, an dem eine von Hand eingetragene Abholzeit die gebuchte
 * Abholzeit überdeckt. Ohne Angleichen gilt weiter die eingetragene Zeit.
 */
export interface PickupOverride {
  /** ISO-Wochentag, 1 = Montag. */
  readonly weekday: number;
  /** Erster solcher Wochentag ab dem Stichtag (YYYY-MM-DD). */
  readonly date: string;
  /** "HH:MM" */
  readonly storedTime: string;
  /** "HH:MM" */
  readonly bookedTime: string;
  /**
   * Darf die eingetragene Zeit schon heute weg? Nein, wenn sie bis zum
   * Stichtag noch gilt und von der bisherigen Buchung abweicht.
   */
  readonly resetNow: boolean;
}

export interface RosterImpact {
  /** Erster Tag, ab dem die Änderung gilt (YYYY-MM-DD). */
  readonly effectiveFrom: string;
  readonly adjusted: readonly AdjustedRosterTemplate[];
  readonly notAdjusted: readonly ManualRosterTemplate[];
  readonly pickupOverrides: readonly PickupOverride[];
}

/** Wandelt die Wire-Form um; fehlt sie, gibt es keine Auswirkung zu zeigen. */
export function mapRosterImpact(
  wire:
    | studentsContract.rosterImpactResponse
    | traegerContractChangesContract.ChangeImpact
    | null
    | undefined,
): RosterImpact | null {
  if (!wire?.effective_from) return null;
  return {
    effectiveFrom: wire.effective_from,
    adjusted: (wire.adjusted ?? []).map((template) => ({
      templateId: template.template_id,
      name: template.name,
      removedWeekdays: template.removed_weekdays ?? [],
      addedWeekdays: template.added_weekdays ?? [],
    })),
    notAdjusted: (wire.not_adjusted ?? []).map((template) => ({
      templateId: template.template_id,
      name: template.name,
      weekdays: template.weekdays ?? [],
      viaTarget: template.via_target === true,
      until: template.until ?? null,
    })),
    // An override without its first day names no day to show.
    pickupOverrides: (wire.pickup_overrides ?? []).flatMap((override) =>
      override.date
        ? [
            {
              weekday: override.weekday,
              date: override.date,
              storedTime: override.stored_time,
              bookedTime: override.booked_time,
              resetNow: override.reset_now === true,
            },
          ]
        : [],
    ),
  };
}

const WEEKDAY_ADVERBS: Record<number, string> = {
  1: "montags",
  2: "dienstags",
  3: "mittwochs",
  4: "donnerstags",
  5: "freitags",
  6: "samstags",
  7: "sonntags",
};

/** „freitags“, „montags und freitags“, „montags, mittwochs und freitags“. */
export function formatWeekdayAdverbs(weekdays: readonly number[]): string {
  const words = [...weekdays]
    .sort((left, right) => left - right)
    .map((weekday) => WEEKDAY_ADVERBS[weekday])
    .filter((word): word is string => word !== undefined);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} und ${words[words.length - 1]}`;
}

/** „RDST 1b: freitags entfernt“ als Teilsatz hinter dem Namen. */
export function describeAdjustment(template: AdjustedRosterTemplate): string {
  const parts: string[] = [];
  if (template.removedWeekdays.length > 0) {
    parts.push(`${formatWeekdayAdverbs(template.removedWeekdays)} entfernt`);
  }
  if (template.addedWeekdays.length > 0) {
    parts.push(`${formatWeekdayAdverbs(template.addedWeekdays)} ergänzt`);
  }
  return parts.join(", ");
}

/**
 * Nimmt das Kind ab dem Stichtag an den Wochentagen aus dem von Hand
 * gepflegten Regeltermin: aus den Hand-Einträgen und aus den schon
 * angelegten künftigen Terminen.
 */
export async function removeStudentTemplateDays(input: {
  templateId: string;
  studentId: string;
  weekdays: readonly number[];
  effectiveFrom: string;
  /** Exklusives Ende (#5497): ab hier bleibt das Kind eingeplant. */
  effectiveUntil?: string | null;
}): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/timetable/templates/{id}/students/{studentId}/remove-days",
    {
      params: { id: input.templateId, studentId: input.studentId },
      body: {
        weekdays: [...input.weekdays],
        effective_from: input.effectiveFrom,
        effective_until: input.effectiveUntil || undefined,
      },
      errorMessage: "Das Kind konnte nicht aus dem Regeltermin entfernt werden",
    },
  );
}

/**
 * Letzter Tag einer Lücke mit exklusivem Ende (#5497): der Tag vor dem
 * Beginn der späteren Buchung.
 */
export function lastGapDay(until: string): string {
  const day = parseISODate(until);
  day.setDate(day.getDate() - 1);
  return toISODate(day);
}

/**
 * Zeitraum, den „Entfernen“ abdeckt: „ab 05.11.2026“ oder, wenn eine spätere
 * Buchung den Termin wieder abdeckt, „vom 05.11.2026 bis 15.11.2026“.
 */
export function formatRemovalSpan(from: string, until: string | null): string {
  return until
    ? `vom ${formatDate(from)} bis ${formatDate(lastGapDay(until))}`
    : `ab ${formatDate(from)}`;
}
