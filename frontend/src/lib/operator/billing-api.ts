import { bffFile, bffJson } from "~/lib/bff-fetch";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import { knownEnum } from "~/lib/contract/known-enum";
import type * as operatorBillingContract from "~/lib/contract/operator-billing.generated";

// The contract decodes a scope it does not know as a string; this build
// knows these two.
const BILLING_KEY_DAY_SCOPE_VALUES = [
  "organization",
  "school",
] as const satisfies readonly operatorBillingContract.BillingKeyDayScope[];

/**
 * Operator billing report (#2791): the key day that applies to every school
 * and the monthly key-date counts the backend captures once per month.
 */

export interface BillingKeyDay {
  keyDay: number;
  /** Next key date as YYYY-MM-DD. */
  nextKeyDate: string;
  updatedAt: string;
  /** Own key days of Träger and schools, Träger before their schools. */
  overrides: BillingKeyDayOverride[];
}

export interface BillingKeyDateCount {
  schoolId: string;
  schoolName: string;
  organizationName: string;
  /** First day of the month as YYYY-MM-DD. */
  period: string;
  /** Key date as YYYY-MM-DD. */
  keyDate: string;
  activeStudents: number;
  activeTerminals: number;
  /** Instant of the capture (RFC 3339). */
  recordedAt: string;
}

/** Whose own key day an override is (#7301). */
export type BillingKeyDayScope = (typeof BILLING_KEY_DAY_SCOPE_VALUES)[number];

/**
 * The own key day of one Träger or one school (#7301). A school's day wins
 * over its Träger's, a Träger's over the day of every school.
 */
export interface BillingKeyDayOverride {
  scope: BillingKeyDayScope;
  id: string;
  /** The Träger of a school, or the Träger itself. */
  organizationId: string;
  name: string;
  /** The Träger of a school; empty for a Träger. */
  organizationName: string;
  keyDay: number;
  /** Next key date as YYYY-MM-DD. */
  nextKeyDate: string;
  updatedAt: string;
}

/** The key day may be 1 to 28, so every month has it. */
export const BILLING_KEY_DAY_MIN = 1;
export const BILLING_KEY_DAY_MAX = 28;

function mapBillingKeyDay(
  data: operatorBillingContract.billingKeyDayResponse,
): BillingKeyDay {
  return {
    keyDay: data.key_day,
    nextKeyDate: data.next_key_date,
    updatedAt: data.updated_at,
    // An override of a scope this build does not know stays out: resetting
    // it would address the wrong level.
    overrides: (data.overrides ?? []).flatMap(mapBillingKeyDayOverride),
  };
}

export function mapBillingKeyDateCount(
  data: operatorBillingContract.billingKeyDateCountResponse,
): BillingKeyDateCount {
  return {
    schoolId: data.school_id,
    schoolName: data.school_name,
    organizationName: data.organization_name,
    period: data.period,
    keyDate: data.key_date,
    activeStudents: data.active_students,
    activeTerminals: data.active_terminals,
    recordedAt: data.recorded_at,
  };
}

function mapBillingKeyDayOverride(
  data: operatorBillingContract.billingKeyDayOverrideResponse,
): BillingKeyDayOverride[] {
  const scope = knownEnum(BILLING_KEY_DAY_SCOPE_VALUES, data.scope);
  if (scope === undefined) return [];
  return [
    {
      scope,
      id: data.id,
      organizationId: data.organization_id,
      name: data.name,
      organizationName: data.organization_name,
      keyDay: data.key_day,
      nextKeyDate: data.next_key_date,
      updatedAt: data.updated_at,
    },
  ];
}

async function putOverride(
  scope: BillingKeyDayScope,
  id: string,
  body: operatorBillingContract.updateBillingKeyDayRequest,
) {
  return scope === "school"
    ? bffJson(
        "platform",
        "PUT /operator/billing/key-day-overrides/schools/{schoolId}",
        { params: { schoolId: id }, body },
      )
    : bffJson(
        "platform",
        "PUT /operator/billing/key-day-overrides/organizations/{organizationId}",
        { params: { organizationId: id }, body },
      );
}

async function deleteOverride(scope: BillingKeyDayScope, id: string) {
  return scope === "school"
    ? bffJson(
        "platform",
        "DELETE /operator/billing/key-day-overrides/schools/{schoolId}",
        { params: { schoolId: id } },
      )
    : bffJson(
        "platform",
        "DELETE /operator/billing/key-day-overrides/organizations/{organizationId}",
        { params: { organizationId: id } },
      );
}

/** YYYY-MM of a period (YYYY-MM-01). */
export function billingMonth(period: string): string {
  return period.slice(0, 7);
}

export const operatorBillingService = {
  async getKeyDay(): Promise<BillingKeyDay> {
    const data = await bffJson("platform", "GET /operator/billing/key-day");
    return mapBillingKeyDay(data);
  },

  async updateKeyDay(keyDay: number): Promise<BillingKeyDay> {
    const data = await bffJson("platform", "PUT /operator/billing/key-day", {
      body: {
        key_day: keyDay,
      } satisfies operatorBillingContract.updateBillingKeyDayRequest,
    });
    return mapBillingKeyDay(data);
  },

  /** Gives a Träger or a school its own key day; answers the key day. */
  async setKeyDayOverride(
    scope: BillingKeyDayScope,
    id: string,
    keyDay: number,
  ): Promise<BillingKeyDay> {
    const data = await putOverride(scope, id, { key_day: keyDay });
    return mapBillingKeyDay(data);
  },

  /** Hands a Träger or a school back to the next level. */
  async resetKeyDayOverride(
    scope: BillingKeyDayScope,
    id: string,
  ): Promise<BillingKeyDay> {
    const data = await deleteOverride(scope, id);
    return mapBillingKeyDay(data);
  },

  async listKeyDateCounts(): Promise<BillingKeyDateCount[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/billing/key-date-counts",
    );
    return data.map(mapBillingKeyDateCount);
  },

  /** Downloads the CSV of one month (YYYY-MM), or of every month. */
  async downloadKeyDateCounts(month?: string): Promise<void> {
    const response = await bffFile(
      "platform",
      "GET /operator/billing/key-date-counts/export",
      {
        query: { month: month || undefined },
        errorMessage: "Key date count export failed",
      },
    );
    const blob = await response.blob();
    const fallback = month
      ? `stichtagszahlen-${month}.csv`
      : "stichtagszahlen.csv";
    downloadBlob(blob, filenameFromDisposition(response) ?? fallback);
  },
};
