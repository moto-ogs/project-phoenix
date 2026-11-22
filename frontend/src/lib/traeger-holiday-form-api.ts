import { bffFile, bffJson, bffJsonUncontracted } from "~/lib/bff-fetch";
/**
 * Client of the registration form of a holiday period (#5198): the
 * Träger-Büro builds the questions with the form builder of the online
 * registration. Every save creates a new version; a registration keeps the
 * version it was sent with. Talks to the BFF route
 * /api/traeger/holiday-periods/{id}/form.
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";
import type * as traegerHolidayPeriodsContract from "./contract/traeger-holiday-periods.generated";
import type { FormLegalBlock } from "./enrollment-form-schema-api";
import {
  holidayFormFieldsFromContract,
  holidayFormVersionFromContract,
  type HolidayAddressRequirement,
  type HolidayHealthRequirement,
  type HolidayFormField,
} from "./holiday-form-field";

export {
  HOLIDAY_FORM_FIELD_TYPES,
  type HolidayAddressRequirement,
  type HolidayFormField,
  type HolidayHealthRequirement,
} from "./holiday-form-field";

/** One version of the form of a holiday period. */
export interface HolidayForm {
  readonly legalBlocks?: readonly FormLegalBlock[];
  readonly version: number;
  readonly fields: readonly HolidayFormField[];
  /** The building block „Anschrift“ of this version (#5625). */
  readonly addressRequirement: HolidayAddressRequirement;
  /** The building block „Gesundheit“ of this version (#6686). */
  readonly healthRequirement: HolidayHealthRequirement;
  readonly createdAt: string;
  /** The standard template (B7); „Standardvorlage einfügen“ adds from it. */
  readonly template: readonly HolidayFormField[];
}

/**
 * The editor saves the whole form back as a new version, so every open
 * enum of a question or legal block fails the read when this build does
 * not know it; the page shows its load error instead of saving a guess.
 */
function formFromBackend(
  form: traegerHolidayPeriodsContract.HolidayFormEditor,
): HolidayForm {
  return {
    ...holidayFormVersionFromContract(form, "HolidayFormEditor"),
    createdAt: form.created_at,
    template: holidayFormFieldsFromContract(
      form.template,
      "HolidayFormEditor.template",
    ),
  };
}

function formPath(periodId: string): string {
  return `/api/traeger/holiday-periods/${encodeURIComponent(periodId)}/form`;
}

/** The current version of the form of a holiday period. */
export async function fetchHolidayForm(periodId: string): Promise<HolidayForm> {
  return formFromBackend(
    await bffJson("org", "GET /traeger/holiday-periods/{id}/form", {
      params: { id: periodId },
    }),
  );
}

/** Saves the questions as a new version of the form. */
export async function saveHolidayForm(
  periodId: string,
  fields: readonly HolidayFormField[],
  legalBlocks: readonly FormLegalBlock[] = [],
  addressRequirement: HolidayAddressRequirement = "off",
  healthRequirement: HolidayHealthRequirement = "optional",
): Promise<HolidayForm> {
  return formFromBackend(
    // The contract leaves the editor's own body undescribed
    // (traeger_route_contracts.go); bff-fetch-uncontracted.test.ts names it.
    await bffJsonUncontracted<traegerHolidayPeriodsContract.HolidayFormEditor>(
      "org",
      "PUT",
      `/api/traeger/holiday-periods/${encodeURIComponent(periodId)}/form`,
      {
        body: {
          fields,
          address_requirement: addressRequirement,
          health_requirement: healthRequirement,
          legal_blocks: legalBlocks.map((block) => ({
            ...block,
            attachments: block.attachments?.map((a) => ({
              label: a.label,
              document_id: a.document_url,
            })),
          })),
        },
      },
    ),
  );
}

function holidayDocumentPath(periodId: string, documentId: string): string {
  return `${formPath(periodId)}/documents/${encodeURIComponent(documentId)}`;
}

/** A PDF of the form's legal blocks, as the office reads it. */
export function fetchHolidayDocument(
  periodId: string,
  documentId: string,
): Promise<Response> {
  return bffFile(
    "org",
    "GET /traeger/holiday-periods/{id}/form/documents/{documentId}",
    {
      params: { id: periodId, documentId },
      errorMessage: "Holiday PDF request failed",
    },
  );
}
export async function uploadHolidayDocument(
  periodId: string,
  file: File,
): Promise<string> {
  const body = new FormData();
  body.append("document", file);
  const result = await bffJson(
    "org",
    "POST /traeger/holiday-periods/{id}/form/documents",
    {
      params: { id: periodId },
      body,
      errorMessage: "Holiday PDF request failed",
    },
  );
  return result.id;
}
export async function deleteHolidayDocument(
  periodId: string,
  id: string,
  options?: { keepalive?: boolean },
): Promise<void> {
  if (options?.keepalive) {
    // The draft's PDF goes when the page goes (pagehide): only a keepalive
    // request outlives it, and bffJson does not send one (#7806).
    const response = await transportFetch(holidayDocumentPath(periodId, id), {
      method: "DELETE",
      keepalive: true,
    });
    if (!response.ok)
      throw await apiErrorFromResponse(response, "Holiday PDF request failed");
    return;
  }
  await bffJson(
    "org",
    "DELETE /traeger/holiday-periods/{id}/form/documents/{documentId}",
    {
      params: { id: periodId, documentId: id },
      errorMessage: "Holiday PDF request failed",
    },
  );
}
