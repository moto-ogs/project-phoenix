// Eine Frage des Anmeldeformulars eines Ferienzeitraums (#5198). Das
// Träger-Portal baut sie, die öffentliche Ferienanmeldung zeigt sie.

import type * as sharedContract from "./contract/shared.generated";
import { requiredEnum } from "./contract/known-enum";
import {
  LEGAL_BLOCK_DISPLAY_MODES,
  LEGAL_BLOCK_KINDS,
  LEGAL_BLOCK_SOURCES,
  type FormLegalBlock,
  type FormField,
  type FormFieldType,
} from "./enrollment-form-schema-api";
import {
  formFieldFromContract,
  translationsFromContract,
} from "./form-field-contract";

/**
 * A question of the holiday form: a form field of the online registration
 * plus the markers „Gesundheitsangabe“ and „OGS sieht die Antwort“. An answer to such a field needs the
 * consent to the health information and appears only in the detail of a
 * registration.
 */
export interface HolidayFormField extends FormField {
  /** Always present in answers of the backend, false included. */
  health?: boolean;
  /**
   * The school that hosts a week sees the answer (#5202). Never on a health
   * question; the backend refuses the combination.
   */
  share_with_host?: boolean;
}

/** The field types the holiday form offers; no structured types, no file. */
export const HOLIDAY_FORM_FIELD_TYPES = [
  "boolean",
  "text",
  "textarea",
  "date",
  "select",
] as const satisfies readonly FormFieldType[];

/**
 * The building block „Anschrift“ of a version (#5625): whether the form asks
 * for street, postal code and city of the parent who registers.
 */
const HOLIDAY_ADDRESS_REQUIREMENTS = ["off", "optional", "required"] as const;

export type HolidayAddressRequirement =
  (typeof HOLIDAY_ADDRESS_REQUIREMENTS)[number];

/**
 * Reads the wire value. Go answers "" for a period without a saved version,
 * which asks for no address; an unknown value fails the read, because the
 * editor would save "off" in its place and parents would skip a required
 * address the backend then refuses.
 */
function holidayAddressRequirement(
  value: string,
  field: string,
): HolidayAddressRequirement {
  return value === ""
    ? "off"
    : requiredEnum(HOLIDAY_ADDRESS_REQUIREMENTS, value, field);
}

/**
 * The building block „Gesundheit“ of a version (#6686): whether parents must
 * answer allergies and medication of each child. A required field takes
 * „Keine“ as its answer.
 */
const HOLIDAY_HEALTH_REQUIREMENTS = ["optional", "required"] as const;

export type HolidayHealthRequirement =
  (typeof HOLIDAY_HEALTH_REQUIREMENTS)[number];

/**
 * Reads the wire value. "" (a period without a saved version) keeps the
 * fields optional; an unknown value fails the read like an unknown address
 * requirement.
 */
function holidayHealthRequirement(
  value: string,
  field: string,
): HolidayHealthRequirement {
  return value === ""
    ? "optional"
    : requiredEnum(HOLIDAY_HEALTH_REQUIREMENTS, value, field);
}

/** One version of the holiday form, as a registration uses it. */
export interface HolidayFormVersion {
  readonly legalBlocks?: readonly FormLegalBlock[];
  readonly version: number;
  readonly fields: readonly HolidayFormField[];
  /** Missing on versions before #5625: no address is asked. */
  readonly addressRequirement?: HolidayAddressRequirement;
  /** Missing on versions before #6686: the health fields are optional. */
  readonly healthRequirement?: HolidayHealthRequirement;
}

/**
 * The questions of a version. A type, target or rule this build does not
 * know fails the read: the editor saves the whole form back, and parents
 * could skip a required question the backend then refuses.
 */
export function holidayFormFieldsFromContract(
  fields: readonly sharedContract.HolidayFormField[] | null,
  at: string,
): HolidayFormField[] {
  return (fields ?? []).map((field, index) => ({
    ...formFieldFromContract(field, `${at}.${index}`),
    health: field.health,
    share_with_host: field.share_with_host,
  }));
}

/**
 * The legal blocks of a version. Stored document IDs stay IDs until a
 * reader chooses its authorized route, so an attachment carries its ID as
 * `document_url`. An unknown kind, source or display mode fails the read
 * for the same reasons as an unknown field type.
 */
function holidayLegalBlocksFromContract(
  blocks: readonly sharedContract.FormLegalBlock[] | null,
  at: string,
): FormLegalBlock[] {
  return (blocks ?? []).map((block, index) => {
    const {
      kind,
      source,
      display_mode: displayMode,
      attachments,
      translations,
      ...rest
    } = block;
    const path = `${at}.${index}`;
    return {
      ...rest,
      kind: requiredEnum(LEGAL_BLOCK_KINDS, kind, `${path}.kind`),
      ...(source === undefined
        ? {}
        : {
            source: requiredEnum(LEGAL_BLOCK_SOURCES, source, `${path}.source`),
          }),
      ...(displayMode === undefined
        ? {}
        : {
            display_mode: requiredEnum(
              LEGAL_BLOCK_DISPLAY_MODES,
              displayMode,
              `${path}.display_mode`,
            ),
          }),
      ...(attachments === undefined
        ? {}
        : {
            attachments: attachments.map((a) => ({
              label: a.label,
              document_url: a.document_id ?? "",
            })),
          }),
      ...(translations === undefined
        ? {}
        : { translations: translationsFromContract(translations) }),
    };
  });
}

/** One version of the holiday form; `at` names it in a read error. */
export function holidayFormVersionFromContract(
  // The parts of a version every holiday form answer carries.
  form: Omit<sharedContract.HolidayPeriodForm, "created_at">,
  at: string,
): Required<HolidayFormVersion> {
  return {
    legalBlocks: holidayLegalBlocksFromContract(
      form.legal_blocks,
      `${at}.legal_blocks`,
    ),
    version: form.version,
    fields: holidayFormFieldsFromContract(form.fields, `${at}.fields`),
    addressRequirement: holidayAddressRequirement(
      form.address_requirement,
      `${at}.address_requirement`,
    ),
    healthRequirement: holidayHealthRequirement(
      form.health_requirement,
      `${at}.health_requirement`,
    ),
  };
}
