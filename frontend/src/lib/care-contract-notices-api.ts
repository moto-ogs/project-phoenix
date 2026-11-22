import { bffJson } from "~/lib/bff-fetch";
/**
 * The Träger-Büro's client of withdrawal and termination (#4682): what a
 * contract allows today, and a declaration the office received by mail or
 * letter.
 */

import {
  type ContractNoticeOptions,
  declarationBody,
  type NoticeDeclaration,
  noticeOptionsFromBackend,
} from "./care-contract-notices";

export async function fetchContractNoticeOptions(
  id: string,
  receivedOn?: string,
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await bffJson("org", "GET /traeger/contract-notices/{id}", {
      params: { id },
      query: { received_on: receivedOn || undefined },
    }),
  );
}

/**
 * Sets the last day of a contract the parents terminated extraordinarily,
 * after the office checked their reason.
 */
export async function setContractNoticeEnd(
  id: string,
  endsOn: string,
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await bffJson("org", "PUT /traeger/contract-notices/{id}/ends-on", {
      params: { id },
      body: { ends_on: endsOn },
    }),
  );
}

/**
 * Records that the office does not accept the reason of an extraordinary
 * termination: it holds as an ordinary termination to expectedEndsOn, the
 * end the office was shown.
 */
export async function rejectContractNoticeReason(
  id: string,
  expectedEndsOn: string,
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await bffJson(
      "org",
      "POST /traeger/contract-notices/{id}/reason-rejection",
      { params: { id }, body: { expected_ends_on: expectedEndsOn } },
    ),
  );
}

/** Records a declaration the office received by mail or letter on a day. */
export async function recordContractNotice(
  id: string,
  declaration: NoticeDeclaration & {
    readonly receivedOn: string;
    readonly dispatchedOn?: string;
  },
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await bffJson("org", "POST /traeger/contract-notices/{id}", {
      params: { id },
      body: {
        ...declarationBody(declaration),
        received_on: declaration.receivedOn,
        ...(declaration.kind === "widerruf"
          ? { dispatched_on: declaration.dispatchedOn }
          : {}),
      },
    }),
  );
}
