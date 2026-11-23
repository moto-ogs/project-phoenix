// The care contracts of an application's children as the school reads them
// (#4788, ADR 0088 section 7): status and booked care of the contracts the
// Träger made from the application. Read-only; the Träger manages them.

import { bffJson } from "./bff-fetch";
import type { ApplicationContractResponse } from "./contract/care-contracts.generated";

export async function getApplicationContracts(
  requestChildIds: readonly string[],
): Promise<ApplicationContractResponse[]> {
  if (requestChildIds.length === 0) return [];
  return bffJson("tenant", "GET /api/care-contracts/", {
    query: { request_child_ids: requestChildIds.join(",") },
    errorMessage: "Die Betreuungsverträge konnten nicht geladen werden",
  });
}
