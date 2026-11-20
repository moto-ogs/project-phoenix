// The care contracts of an application's children as the school reads them
// (#4788, ADR 0088 section 7): status and booked care of the contracts the
// Träger made from the application. Read-only; the Träger manages them.

import { apiErrorFromResponse } from "./api-error";
import type { ApplicationContractResponse } from "./contract/care-contracts.generated";
import { sessionFetch } from "./session-cache";

export async function getApplicationContracts(
  requestChildIds: readonly string[],
): Promise<ApplicationContractResponse[]> {
  if (requestChildIds.length === 0) return [];
  const query = encodeURIComponent(requestChildIds.join(","));
  const response = await sessionFetch(
    `/api/care-contracts/?request_child_ids=${query}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      "Die Betreuungsverträge konnten nicht geladen werden",
    );
  }
  const json = (await response.json()) as {
    data: ApplicationContractResponse[] | null;
  };
  return json.data ?? [];
}
