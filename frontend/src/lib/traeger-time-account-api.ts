/**
 * Das Stundenkonto einer Personalakte über alle Schulen und der
 * Monatsabschluss des Trägers (#4711, ADR 0242).
 *
 * Jede Schule rechnet ihre Monatskarte selbst; das Konto ist die Summe. Mit
 * einem Arbeitsvertrag beim Träger schließt die Personalverwaltung den Monat
 * in jeder Schule ab, die der Vertrag abdeckt, und nur sie öffnet ihn wieder.
 * Jedes Laden steht im Zugriffsprotokoll jeder Schule; nichts wird
 * zwischengespeichert.
 */
import { traegerRequest } from "~/lib/traeger-api";

const RECORDS = "/api/traeger/staff-records";

/** Wie der Monat beim Träger steht. */
type TraegerMonthState =
  /** Ein Vertrag deckt den Monat ab, eine Schule ist noch offen. */
  | "open"
  /** Jede Schule, die der Träger abschließt, ist abgeschlossen. */
  | "closed"
  /** Kein Vertrag deckt den Monat ab: die Schulen schließen selbst ab. */
  | "school";

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
  readonly state: TraegerMonthState;
  /** Der Monat ist vorbei; erst dann lässt er sich abschließen. */
  readonly ended: boolean;
  readonly schools: readonly TraegerTimeAccountSchool[];
}

interface BackendMinutes {
  target_minutes: number;
  actual_minutes: number;
  credited_minutes: number;
  adjustment_minutes: number;
  balance_minutes: number;
  carry_in_minutes: number;
  closing_balance_minutes: number;
}

interface BackendSchool extends BackendMinutes {
  school_id: number;
  school_name: string;
  has_target: boolean;
  by_traeger: boolean;
  closed: boolean;
  closed_by_traeger: boolean;
  closed_at?: string | null;
  close_reason?: string | null;
  drift_minutes: number;
  later_closed?: string | null;
}

interface BackendAccount extends BackendMinutes {
  year: number;
  month: number;
  state: TraegerMonthState;
  ended: boolean;
  schools: BackendSchool[] | null;
}

function mapMinutes(data: BackendMinutes): TraegerTimeAccountMinutes {
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

function mapTraegerTimeAccount(data: BackendAccount): TraegerTimeAccount {
  return {
    ...mapMinutes(data),
    year: data.year,
    month: data.month,
    state: data.state,
    ended: data.ended,
    schools: (data.schools ?? []).map((school) => ({
      ...mapMinutes(school),
      schoolId: String(school.school_id),
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
    await traegerRequest<BackendAccount>(
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
    await traegerRequest<BackendAccount>(`${accountPath(recordId)}/${action}`, {
      method: "POST",
      body: {
        year: input.year,
        month: input.month,
        reason: input.reason.trim(),
      },
    }),
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
