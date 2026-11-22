import { bffJson } from "~/lib/bff-fetch";
/**
 * The Träger-Büro's client of the parents' changes of the booked care
 * (#5979): the open change of a contract's child and its decision.
 */

import {
  type ContractChangeDecision,
  type ContractChanges,
  contractChangesFromBackend,
  decisionBody,
} from "./care-contract-changes";

export async function fetchContractChanges(
  contractId: string,
  effectiveFrom?: string,
): Promise<ContractChanges> {
  return contractChangesFromBackend(
    await bffJson("org", "GET /traeger/contract-changes/{id}", {
      params: { id: contractId },
      query: { effective_from: effectiveFrom || undefined },
    }),
  );
}

/** Approves or rejects one request; answers the changes afterwards. */
export async function decideContractChange(
  contractId: string,
  requestId: string,
  decision: ContractChangeDecision,
): Promise<ContractChanges> {
  return contractChangesFromBackend(
    await bffJson(
      "org",
      "POST /traeger/contract-changes/{id}/requests/{requestId}/decide",
      { params: { id: contractId, requestId }, body: decisionBody(decision) },
    ),
  );
}
