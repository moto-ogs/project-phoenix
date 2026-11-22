/**
 * Das Stundenkonto einer Personalakte über alle Schulen und der
 * Monatsabschluss des Trägers (#4711, ADR 0243).
 *
 * Jede Schule rechnet ihre Monatskarte selbst; das Konto ist die Summe. Mit
 * einem Arbeitsvertrag beim Träger schließt die Personalverwaltung den Monat
 * in jeder Schule ab, die der Vertrag abdeckt, und nur sie öffnet ihn wieder.
 * Jedes Laden steht im Zugriffsprotokoll jeder Schule; nichts wird
 * zwischengespeichert.
 */
import type * as traegerStaffRecordsContract from "~/lib/contract/traeger-staff-records.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { traegerRequest } from "~/lib/traeger-api";

const RECORDS = "/api/traeger/staff-records";

/**
 * Wie der Monat beim Träger steht. `open`: ein Vertrag deckt den Monat ab,
 * eine Schule ist noch offen. `closed`: jede Schule, die der Träger
 * abschließt, ist abgeschlossen. `school`: kein Vertrag deckt den Monat ab,
 * die Schulen schließen selbst ab. Go meldet die Menge nicht an; der Vertrag
 * führt `string`.
 */
const MONTH_STATE_VALUES = ["open", "closed", "school"] as const;
type TraegerMonthState = (typeof MONTH_STATE_VALUES)[number];

interface TraegerTimeAccountMinutes {
  readonly targetMinutes: number;
  readonly actualMinutes: number;
  readonly creditedMinutes: number;
  readonly adjustmentMinutes: number;
  readonly balanceMinutes: number;
  readonly carryInMinutes: number;
  readonly closingBalanceMinutes: number;
}

export interface TraegerTimeAccountSchool extends TraegerTimeAccountMinutes {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly hasTarget: boolean;
  /** Ein Vertrag des Trägers deckt den Monat an dieser Schule ab. */
  readonly byTraeger: boolean;
  readonly closed: boolean;
  readonly closedByTraeger: boolean;
  readonly closedAt: string | null;
  readonly closeReason: string;
  /** Was sich an der Schule seit dem Abschluss geändert hat. */
  readonly driftMinutes: number;
  /** Ein späterer abgeschlossener Monat (YYYY-MM), sonst null. */
  readonly laterClosed: string | null;
}

export interface TraegerTimeAccount extends TraegerTimeAccountMinutes {
  readonly year: number;
  readonly month: number;
  /** undefined: ein Stand, den dieser Build nicht kennt; nichts lässt sich abschließen. */
  readonly state: TraegerMonthState | undefined;
  /** Der Monat ist vorbei; erst dann lässt er sich abschließen. */
  readonly ended: boolean;
  readonly schools: readonly TraegerTimeAccountSchool[];
}

function mapMinutes(
  data:
    | traegerStaffRecordsContract.TraegerTimeAccount
    | traegerStaffRecordsContract.TraegerTimeAccountSchool,
): TraegerTimeAccountMinutes {
  return {
    targetMinutes: data.target_minutes,
    actualMinutes: data.actual_minutes,
    creditedMinutes: data.credited_minutes,
    adjustmentMinutes: data.adjustment_minutes,
    balanceMinutes: data.balance_minutes,
    carryInMinutes: data.carry_in_minutes,
    closingBalanceMinutes: data.closing_balance_minutes,
  };
}

function mapTraegerTimeAccount(
  data: traegerStaffRecordsContract.TraegerTimeAccount,
): TraegerTimeAccount {
  return {
    ...mapMinutes(data),
    year: data.year,
    month: data.month,
    state: knownEnum(MONTH_STATE_VALUES, data.state),
    ended: data.ended,
    schools: (data.schools ?? []).map((school) => ({
      ...mapMinutes(school),
      schoolId: school.school_id,
      schoolName: school.school_name,
      hasTarget: school.has_target,
      byTraeger: school.by_traeger,
      closed: school.closed,
      closedByTraeger: school.closed_by_traeger,
      closedAt: school.closed_at ?? null,
      closeReason: school.close_reason ?? "",
      driftMinutes: school.drift_minutes,
      laterClosed: school.later_closed ?? null,
    })),
  };
}

const accountPath = (recordId: string) =>
  `${RECORDS}/${encodeURIComponent(recordId)}/time-account`;

export async function fetchTraegerTimeAccount(
  recordId: string,
  year: number,
  month: number,
): Promise<TraegerTimeAccount> {
  return mapTraegerTimeAccount(
    await traegerRequest<traegerStaffRecordsContract.TraegerTimeAccount>(
      `${accountPath(recordId)}?year=${year}&month=${month}`,
    ),
  );
}

async function changeMonth(
  recordId: string,
  action: "close" | "reopen",
  input: { year: number; month: number; reason: string },
): Promise<TraegerTimeAccount> {
  return mapTraegerTimeAccount(
    await traegerRequest<traegerStaffRecordsContract.TraegerTimeAccount>(
      `${accountPath(recordId)}/${action}`,
      {
        method: "POST",
        body: {
          year: input.year,
          month: input.month,
          reason: input.reason.trim(),
        } satisfies traegerStaffRecordsContract.TimeAccountMonthRequest,
      },
    ),
  );
}

/** Schließt den Monat in jeder Schule ab, die der Vertrag abdeckt. */
export const closeTraegerTimeAccountMonth = (
  recordId: string,
  input: { year: number; month: number; reason: string },
) => changeMonth(recordId, "close", input);

/** Öffnet den Abschluss des Trägers in jeder Schule wieder. */
export const reopenTraegerTimeAccountMonth = (
  recordId: string,
  input: { year: number; month: number; reason: string },
) => changeMonth(recordId, "reopen", input);
