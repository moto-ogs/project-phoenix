// Narrows the form schema of the contract (open enums, translation records
// that may hold null) into the form types of the online registration (#2353).
// Every reader of these types may save the whole form back, so a value this
// build does not know fails the read instead of being guessed or dropped.

import type * as sharedContract from "./contract/shared.generated";
import { requiredEnum } from "./contract/known-enum";
import {
  CONDITION_OPERATORS,
  CONDITION_SOURCES,
  FORM_FIELD_TARGETS,
  FORM_FIELD_TYPES,
  type FormField,
  type FormFieldOption,
  type VisibilityCondition,
} from "./enrollment-form-schema-api";
import type { Translations } from "./enrollment-translations";
import {
  ENROLLMENT_FILE_TYPES,
  type FileFieldOptions,
} from "./enrollment-uploads";

type WireTranslations = Record<
  string,
  Record<string, sharedContract.TranslatedText> | null
>;

/** The translations of a text, without the languages the decoder left null. */
export function translationsFromContract(
  translations: WireTranslations | undefined,
): Translations | undefined {
  if (translations === undefined) return undefined;
  const present: Translations = {};
  for (const [locale, texts] of Object.entries(translations)) {
    if (texts !== null) present[locale] = texts;
  }
  return present;
}

function optionFromContract(
  option: sharedContract.FormFieldOption,
): FormFieldOption {
  const { translations, ...rest } = option;
  return {
    ...rest,
    ...(translations === undefined
      ? {}
      : { translations: translationsFromContract(translations) }),
  };
}

function fileOptionsFromContract(
  options: sharedContract.FormFileOptions,
  at: string,
): FileFieldOptions {
  return {
    allowed_types: (options.allowed_types ?? []).map((type, index) =>
      requiredEnum(ENROLLMENT_FILE_TYPES, type, `${at}.allowed_types.${index}`),
    ),
    max_size_mb: options.max_size_mb,
    multiple: options.multiple ?? false,
  };
}

type ConditionValue = VisibilityCondition["value"];

function conditionValue(value: unknown, at: string): ConditionValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error(`contract: ${at} has an unknown value`);
}

function conditionFromContract(
  condition: sharedContract.VisibilityCondition,
  at: string,
): VisibilityCondition {
  const value = conditionValue(condition.value, `${at}.value`);
  return {
    source: requiredEnum(CONDITION_SOURCES, condition.source, `${at}.source`),
    ...(condition.field === undefined ? {} : { field: condition.field }),
    operator: requiredEnum(
      CONDITION_OPERATORS,
      condition.operator,
      `${at}.operator`,
    ),
    ...(value === undefined ? {} : { value }),
  };
}

/**
 * One field of a form schema. `at` names the field in the error, such as
 * "HolidayFormEditor.fields.2".
 */
export function formFieldFromContract(
  field: sharedContract.FormField,
  at: string,
): FormField {
  const {
    type,
    target,
    options,
    file_options: fileOptions,
    visible_when: visibleWhen,
    translations,
    ...rest
  } = field;
  return {
    ...rest,
    type: requiredEnum(FORM_FIELD_TYPES, type, `${at}.type`),
    ...(target === undefined
      ? {}
      : { target: requiredEnum(FORM_FIELD_TARGETS, target, `${at}.target`) }),
    ...(options === undefined
      ? {}
      : { options: options.map(optionFromContract) }),
    ...(fileOptions === undefined
      ? {}
      : {
          file_options: fileOptionsFromContract(
            fileOptions,
            `${at}.file_options`,
          ),
        }),
    ...(visibleWhen === undefined
      ? {}
      : {
          visible_when: conditionFromContract(
            visibleWhen,
            `${at}.visible_when`,
          ),
        }),
    ...(translations === undefined
      ? {}
      : { translations: translationsFromContract(translations) }),
  };
}
