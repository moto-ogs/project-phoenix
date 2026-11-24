/**
 * Client of the families of contracts without a mail address (#7161, ADR
 * 0319): the contracts with their families and the newest changes, the join
 * of contracts to one family and the leave of one contract. Every write
 * carries the version the office read (ADR 0311). Backend int64 IDs leave
 * here as strings; calendar dates stay "YYYY-MM-DD".
 */

import { bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type * as familiesContract from "./contract/traeger-contract-families.generated";

const ACTION_VALUES = ["join_family", "leave_family"] as const;

/** A change of a family: a contract joined one or left it. */
type ContractFamilyAction = (typeof ACTION_VALUES)[number];

/** A contract without a mail address with the leading contract of its family. */
export interface ContractFamilyMember {
  readonly contractId: string;
  /** The leading contract; the contract itself when it is alone or leads. */
  readonly familyContractId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly childBirthDate: string | null;
  /** The parties as the contract names them; "" without one. */
  readonly partyName: string;
}

/** One join or leave of the trail. */
export interface ContractFamilyEvent {
  readonly id: string;
  /** undefined: an action this build does not know. */
  readonly action: ContractFamilyAction | undefined;
  readonly contractId: string;
  /** The leading contract after the change. */
  readonly familyContractId: string;
  /** The leading contract before the change. */
  readonly previousFamilyContractId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  /** null: the account was deleted. */
  readonly accountId: string | null;
  readonly at: string;
}

export interface ContractFamilies {
  /** The state the office read; every write sends it back. */
  readonly version: string;
  readonly contracts: readonly ContractFamilyMember[];
  /** The newest changes first. */
  readonly events: readonly ContractFamilyEvent[];
}

function mapFamilies(
  wire: familiesContract.ContractFamilySet,
): ContractFamilies {
  return {
    version: wire.version,
    contracts: (wire.contracts ?? []).map((contract) => ({
      contractId: contract.contract_id,
      familyContractId: contract.family_contract_id,
      schoolId: contract.school_id,
      schoolName: contract.school_name,
      childFirstName: contract.child_first_name,
      childLastName: contract.child_last_name,
      childBirthDate: contract.child_birth_date,
      partyName: contract.party_name,
    })),
    events: (wire.events ?? []).map((event) => ({
      id: event.id,
      action: knownEnum(ACTION_VALUES, event.action),
      contractId: event.contract_id,
      familyContractId: event.family_contract_id,
      previousFamilyContractId: event.previous_family_contract_id,
      childFirstName: event.child_first_name,
      childLastName: event.child_last_name,
      accountId: event.account_id,
      at: event.at,
    })),
  };
}

/** Reads the contracts without a mail address with their families. */
export async function fetchContractFamilies(): Promise<ContractFamilies> {
  return mapFamilies(await bffJson("org", "GET /traeger/contract-families/"));
}

/**
 * Joins the contracts, and every contract of their families, to one family
 * led by `familyContractId`.
 */
export async function joinContractFamily(request: {
  readonly contractIds: readonly string[];
  readonly familyContractId: string;
  readonly expectedVersion: string;
}): Promise<ContractFamilies> {
  return mapFamilies(
    await bffJson("org", "POST /traeger/contract-families/", {
      body: {
        contract_ids: [...request.contractIds],
        family_contract_id: request.familyContractId,
        expected_version: request.expectedVersion,
      },
    }),
  );
}

/** Gives a contract led by another its own family back. */
export async function leaveContractFamily(
  contractId: string,
  expectedVersion: string,
): Promise<ContractFamilies> {
  return mapFamilies(
    await bffJson("org", "POST /traeger/contract-families/{contractId}/leave", {
      params: { contractId },
      body: { expected_version: expectedVersion },
    }),
  );
}
