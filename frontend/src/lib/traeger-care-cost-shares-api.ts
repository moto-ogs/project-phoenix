/**
 * Client of the cost bearer shares of the monthly contribution (#4687): which
 * cost bearer (Bildung und Teilhabe, Jugendamt, another subsidy) pays which
 * part of a contract's contribution, with its validity and a reference to the
 * proof, and the list of a run for one cost bearer. Shares stay basis points
 * (10000 = 100 %) or whole cent; backend int64 IDs leave here as strings;
 * calendar dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type {
  CareCostShare as WireShare,
  CareCostShareRequest,
  CareCostShareSet as WireSet,
} from "./contract/traeger-care-cost-shares.generated";
import { traegerRequest } from "./traeger-api";
import { type BillingFile, billingFile } from "./traeger-billing-api";
import {
  type CareCostShareKind,
  type CareCostShareScope,
  knownCostShareKind,
  knownCostShareScope,
} from "./traeger-care-billing-api";

// Go does not register the set; the contract types it as string.
const STATUS_VALUES = ["upcoming", "active", "expiring", "expired"] as const;

/** Where a share stands today; `expiring` ends within `warningDays`. */
type CareCostShareStatus = (typeof STATUS_VALUES)[number];

/**
 * undefined kind or scope: one this build does not know; saving it again
 * lets the backend refuse it at its field.
 */
export interface CareCostShare {
  readonly id: string;
  readonly contractId: string;
  readonly kind: CareCostShareKind | undefined;
  readonly costBearerId: string;
  readonly costBearerName: string;
  readonly shareBasisPoints: number | null;
  readonly shareCents: number | null;
  /** What the share covers (#4686): the modules, the Mensa or both. */
  readonly scope: CareCostShareScope | undefined;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly reference: string;
  readonly checkedOn: string;
  readonly status: CareCostShareStatus | undefined;
}

export type CareCostShareInput = Omit<
  CareCostShare,
  "id" | "costBearerName" | "status"
>;

export interface CareCostShareContract {
  readonly contractId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly shares: readonly CareCostShare[];
}

interface CareCostShareBearer {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface CareCostShareSet {
  readonly contracts: readonly CareCostShareContract[];
  readonly costBearers: readonly CareCostShareBearer[];
  /** Shares that end soon without a follow-up. */
  readonly expiring: number;
  readonly warningDays: number;
}

export type CareCostShareExportFormat = "pdf" | "xlsx" | "csv";

const SHARES_PATH = "/api/traeger/care-cost-shares";

function shareFromBackend(share: WireShare): CareCostShare {
  return {
    id: share.id,
    contractId: share.contract_id,
    kind: knownCostShareKind(share.kind),
    costBearerId: share.cost_bearer_id,
    costBearerName: share.cost_bearer_name,
    shareBasisPoints: share.share_basis_points,
    shareCents: share.share_cents,
    scope: knownCostShareScope(share.scope),
    validFrom: requiredDay(share.valid_from, "care_cost_share.valid_from"),
    validUntil: requiredDay(share.valid_until, "care_cost_share.valid_until"),
    reference: share.reference,
    checkedOn: requiredDay(share.checked_on, "care_cost_share.checked_on"),
    status: knownEnum(STATUS_VALUES, share.status),
  };
}

function costShareSetFromBackend(body: WireSet): CareCostShareSet {
  return {
    contracts: (body.contracts ?? []).map((contract) => ({
      contractId: contract.contract_id,
      schoolId: contract.school_id,
      schoolName: contract.school_name,
      childFirstName: contract.child_first_name,
      childLastName: contract.child_last_name,
      shares: (contract.shares ?? []).map(shareFromBackend),
    })),
    costBearers: (body.cost_bearers ?? []).map((bearer) => ({
      id: bearer.id,
      name: bearer.name,
      active: bearer.active,
    })),
    expiring: body.expiring,
    warningDays: body.warning_days,
  };
}

function shareBody(input: CareCostShareInput): CareCostShareRequest {
  return {
    contract_id: input.contractId,
    kind: input.kind,
    cost_bearer_id: input.costBearerId,
    share_basis_points: input.shareBasisPoints,
    share_cents: input.shareCents,
    scope: input.scope,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    reference: input.reference,
    checked_on: input.checkedOn,
  };
}

/** Reads the shares; the backend records the read per contract. */
export async function fetchCareCostShares(): Promise<CareCostShareSet> {
  return costShareSetFromBackend(await traegerRequest<WireSet>(SHARES_PATH));
}

/** Creates a share without `shareId`, changes that one otherwise. */
export async function saveCareCostShare(
  shareId: string | null,
  input: CareCostShareInput,
): Promise<CareCostShareSet> {
  return costShareSetFromBackend(
    await traegerRequest<WireSet>(
      shareId ? `${SHARES_PATH}/${encodeURIComponent(shareId)}` : SHARES_PATH,
      { method: shareId ? "PUT" : "POST", body: shareBody(input) },
    ),
  );
}

export async function deleteCareCostShare(
  shareId: string,
): Promise<CareCostShareSet> {
  return costShareSetFromBackend(
    await traegerRequest<WireSet>(
      `${SHARES_PATH}/${encodeURIComponent(shareId)}`,
      { method: "DELETE" },
    ),
  );
}

/** The list of a run for one cost bearer, to bill its part separately. */
export async function downloadCareCostShareList(
  runId: string,
  costBearerId: string,
  format: CareCostShareExportFormat,
): Promise<BillingFile> {
  return billingFile(
    `/api/traeger/care-billing-runs/${encodeURIComponent(runId)}/cost-shares/${encodeURIComponent(costBearerId)}/export?format=${format}`,
    {},
    `kostentraeger.${format}`,
  );
}
