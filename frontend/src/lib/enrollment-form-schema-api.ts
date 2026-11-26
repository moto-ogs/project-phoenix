import { bffJson } from "~/lib/bff-fetch";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { createLogger } from "~/lib/logger";
import { logEnrollmentFailure } from "~/lib/enrollment-api-error";
import type { Translations } from "~/lib/enrollment-translations";
import { requiredEnum } from "~/lib/contract/known-enum";
import {
  ENROLLMENT_FILE_TYPES,
  type FileFieldOptions,
} from "~/lib/enrollment-uploads";

const logger = createLogger({ component: "EnrollmentFormSchemaAPI" });

/** Field types accepted by the backend FormFieldType enum. */
const FORM_FIELD_TYPES = [
  "boolean",
  "number",
  "text",
  "textarea",
  "date",
  "select",
  "information",
  "phone_list",
  "weekday_schedule",
  "weekday_boolean",
  "weekday_mode",
  "weekday_multi_mode",
  "contact_list",
  "file",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/**
 * Source of a field's visibility condition. Mirrors the backend
 * ConditionSource* constants in
 * backend/modules/enrollment/form_schema_types.go.
 * - "field": another custom boolean/select field in the same schema
 * - "grade_level": the per-child core field target_grade_level
 * - "care_offering": the child's selected care offering IDs
 */
const CONDITION_SOURCES = ["field", "grade_level", "care_offering"] as const;

export type ConditionSource = (typeof CONDITION_SOURCES)[number];

/** Visibility operators (backend ConditionOp* constants). */
const CONDITION_OPERATORS = ["eq", "neq", "not_empty", "includes"] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/**
 * Makes a field appear only when a controlling value matches. Mirrors
 * backend VisibilityCondition. null/undefined = always visible.
 */
export interface VisibilityCondition {
  source: ConditionSource;
  /** Controlling custom field key (only when source === "field"). */
  field?: string;
  operator: ConditionOperator;
  /** Compared value; omitted for the "not_empty" operator. */
  value?: string | number | boolean | null;
}

/**
 * Reserved targets that link a form field to a downstream Stammdaten
 * column / association table. Empty string (or absent) keeps the
 * field as free custom_data only. Keep in sync with
 * backend/modules/enrollment/form_schema.go ReservedTargets.
 *
 * Photo consent and guardian phone number are NOT picker options:
 * the public base form already collects them (consent_flags.photo
 * checkbox + guardian_phone input). The decision service writes
 * them onto the Student / guardian_phone_numbers automatically.
 */
const FORM_FIELD_TARGETS = [
  "",
  "student.health_info",
  "student.extra_info",
  // student.departure is the canonical unified target (#1610): per weekday how
  // the child leaves (alone/bus/pickup). student.bus_days / student.bus /
  // student.pickup_status are legacy aliases kept so older saved schemas still
  // resolve; they are not offered in the picker for new fields.
  "student.allowed_departure_modes",
  "student.departure",
  "student.bus_days",
  "student.bus",
  "student.pickup_status",
  "schedule.pickup",
  "schedule.arrival",
  "student.contacts",
] as const;

export type FormFieldTarget = (typeof FORM_FIELD_TARGETS)[number];

export interface ReservedTargetSpec {
  type: FormFieldType;
  appliesToChild: boolean;
  label: string;
}

/** Mirror of the backend ReservedTargets map, for the admin editor. */
export const RESERVED_TARGETS: Record<
  Exclude<FormFieldTarget, "">,
  ReservedTargetSpec
> = {
  "student.health_info": {
    type: "textarea",
    appliesToChild: true,
    label: "Gesundheitsinformationen",
  },
  "student.extra_info": {
    type: "textarea",
    appliesToChild: true,
    label: "Hinweise an die Betreuung",
  },
  "student.allowed_departure_modes": {
    type: "weekday_multi_mode",
    appliesToChild: true,
    label: "Erlaubte Heimwege",
  },
  "student.departure": {
    type: "weekday_mode",
    appliesToChild: true,
    label: "Geh- und Abholregelung",
  },
  "student.bus_days": {
    type: "weekday_boolean",
    appliesToChild: true,
    label: "Buskind",
  },
  "student.bus": {
    type: "weekday_boolean",
    appliesToChild: true,
    label: "Buskind",
  },
  "student.pickup_status": {
    type: "weekday_boolean",
    appliesToChild: true,
    label: "Abholregelung",
  },
  "schedule.pickup": {
    type: "weekday_schedule",
    appliesToChild: true,
    label: "Abholzeiten",
  },
  "schedule.arrival": {
    type: "weekday_schedule",
    appliesToChild: true,
    label: "Ankunftszeiten",
  },
  "student.contacts": {
    type: "contact_list",
    appliesToChild: true,
    label: "Weitere Kontakte / Abholberechtigte / Notfallkontakte",
  },
};

interface FormFieldOption {
  label: string;
  value: string;
  /** School-written translations of `label` (#3377). */
  translations?: Translations;
}

interface FormFieldValidation {
  min?: number | null;
  max?: number | null;
  pattern?: string | null;
}

const MAX_ENROLLMENT_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** The document limit as the editor names it ("10 MB"). */
export const MAX_ENROLLMENT_DOCUMENT_SIZE_LABEL = `${MAX_ENROLLMENT_DOCUMENT_BYTES / (1024 * 1024)} MB`;

/**
 * Why a chosen file cannot become a form document (legal PDF or PDF
 * attachment), or null. The backend checks the content again on upload.
 */
export function enrollmentDocumentProblem(
  file: File,
): "not_pdf" | "too_large" | null {
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return "not_pdf";
  }
  if (file.size > MAX_ENROLLMENT_DOCUMENT_BYTES) return "too_large";
  return null;
}

export interface FormAttachment {
  label: string;
  document_url: string;
}

/**
 * A field of a form schema: the contract's field with its enums narrowed.
 * `content` is the body of an `information` block; `allowed_times` limits a
 * `weekday_schedule` to fixed `HH:MM` values; `single_mode_grades` is the
 * Heimweg-Beschränkung (#2381) of `student.allowed_departure_modes`;
 * `file_options` are the rules of a `file` field (#4783); `target` links the
 * answer to a Stammdaten column at approval; `visible_when` shows the field
 * only when its condition matches (null/undefined = always visible).
 */
export type FormField = Omit<
  sharedContract.FormField,
  | "type"
  | "options"
  | "validation"
  | "file_options"
  | "target"
  | "visible_when"
  | "translations"
> & {
  type: FormFieldType;
  options?: FormFieldOption[];
  validation?: FormFieldValidation | null;
  file_options?: FileFieldOptions;
  target?: FormFieldTarget;
  visible_when?: VisibilityCondition | null;
  /**
   * School-written translations of `label`, `help_text` and `content`
   * (#3377). Option labels translate on the option itself.
   */
  translations?: Translations;
};

/**
 * `signature` asks the parent to sign the enrollment and every later edit
 * with a simple electronic signature with a drawn signature (#4786).
 * `holiday_care_wish` asks, and requires, per child whether the child needs
 * care in the holidays (#4703); the Träger's holiday registration reads the
 * approved answer.
 */
export type CoreRequirementKey =
  "guardian_phone" | "signature" | "holiday_care_wish";

/** Whether the form asks the holiday care wish of every child (#4703). */
export function holidayCareWishAsked(
  schema: Pick<PublicFormSchema, "core_requirements"> | null | undefined,
): boolean {
  return schema?.core_requirements?.holiday_care_wish === true;
}

export type CoreRequirements = Partial<Record<CoreRequirementKey, boolean>>;

export const LEGAL_BLOCK_KINDS = [
  "terms",
  "privacy_notice",
  "notice",
  "consent",
] as const;

type LegalBlockKind = (typeof LEGAL_BLOCK_KINDS)[number];

export const LEGAL_BLOCK_SOURCES = ["standard", "custom"] as const;

type LegalBlockSource = (typeof LEGAL_BLOCK_SOURCES)[number];

export const LEGAL_BLOCK_DISPLAY_MODES = ["text", "pdf"] as const;

export type LegalBlockDisplayMode = (typeof LEGAL_BLOCK_DISPLAY_MODES)[number];

/**
 * A legal block of a form: the contract's block with its enums narrowed.
 * A consent with `guardian_agreement` also confirms the agreement of every
 * other custodian (#2787).
 */
export type FormLegalBlock = Omit<
  sharedContract.FormLegalBlock,
  "kind" | "source" | "display_mode" | "translations"
> & {
  kind: LegalBlockKind;
  source?: LegalBlockSource;
  display_mode?: LegalBlockDisplayMode;
  /** School-written translations of `title`, `label` and `text` (#3377). */
  translations?: Translations;
};

/** A form schema version with its fields, rules and legal blocks. */
export type FormSchema = Omit<
  enrollmentContract.FormSchemaResponse,
  "fields" | "core_requirements" | "legal_blocks"
> & {
  fields: FormField[];
  core_requirements?: CoreRequirements;
  legal_blocks?: FormLegalBlock[];
};

/**
 * Lists every schema version for the current tenant (newest first).
 * The Phasen admin page uses this to populate the "use schema X for
 * this phase" dropdown.
 */
export async function listSchemas(): Promise<FormSchema[]> {
  const schemas = await bffJson(
    "tenant",
    "GET /api/enrollment/schema/versions",
    { errorMessage: "Formularvorlagen konnten nicht geladen werden" },
  );
  return schemas.map(formSchemaFromContract);
}

export function latestSchemasByName(schemas: FormSchema[]): FormSchema[] {
  const latest = new Map<string, FormSchema>();
  for (const schema of schemas) {
    const existing = latest.get(schema.name);
    if (
      !existing ||
      schema.version > existing.version ||
      (schema.version === existing.version &&
        schema.created_at > existing.created_at)
    ) {
      latest.set(schema.name, schema);
    }
  }
  return [...latest.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

/**
 * The form a parent fills in: the active schema's fields, rules and legal
 * blocks. Null in a bootstrap when no schema has been published yet: the
 * form then asks the core fields only.
 */
export type PublicFormSchema = Pick<
  FormSchema,
  "id" | "version" | "fields" | "core_requirements" | "legal_blocks"
>;

export function schemaToPublicFormSchema(schema: FormSchema): PublicFormSchema {
  return {
    id: schema.id,
    version: schema.version,
    fields: schema.fields,
    ...(schema.core_requirements === undefined
      ? {}
      : { core_requirements: schema.core_requirements }),
    ...(schema.legal_blocks === undefined
      ? {}
      : { legal_blocks: schema.legal_blocks }),
  };
}

/**
 * The staff preview of the parent form: `enrollment_enabled` and
 * `phase_offerings` (typed in `enrollment-phase-preview-api.ts`) only for a
 * phase preview.
 */
export type EnrollmentPreviewBootstrap = Omit<
  enrollmentContract.SchemaPreviewBootstrapResponse,
  "schema"
> & { schema: FormSchema | null };

export async function fetchEnrollmentPreviewBootstrap(params: {
  phaseId?: string;
  schemaId?: string | null;
  base?: boolean;
}): Promise<EnrollmentPreviewBootstrap> {
  const { schema, ...preview } = await bffJson(
    "tenant",
    "GET /api/enrollment/schema/preview",
    {
      query: {
        schemaId: params.schemaId || undefined,
        phaseId: params.phaseId || undefined,
        base: params.base ? "1" : undefined,
      },
      errorMessage: "Formularvorschau konnte nicht geladen werden",
    },
  );
  return {
    ...preview,
    schema: schema && formSchemaFromContract(schema),
  };
}

/**
 * Public Cloudflare Turnstile config for a tenant. enabled mirrors the
 * server-side enrollment.require_captcha setting; site_key is the
 * public Turnstile site key (safe to render in the widget). Only enabled
 * captcha with a site key mounts the widget. Enabled captcha without a
 * site key blocks submission; the backend also enforces verification.
 */
export interface PublicCaptchaConfig {
  enabled: boolean;
  site_key: string;
}

/** A legal block of the public form: translations still matching the German text. */
export type PublicLegalBlock = Omit<
  sharedContract.LegalBlock,
  "kind" | "source" | "translations"
> & {
  kind: LegalBlockKind;
  source?: LegalBlockSource;
  translations?: Translations;
};

/**
 * Per-tenant legal documents and the configured blocks shown on the public
 * form. Empty raw strings remain for compatibility; `blocks` is the canonical
 * render/validation contract for the form. `health_consent` is the consent
 * moto adds to a form asking for health information; only the tenant-wide
 * read carries it, for the template preview (#2787).
 */
export type PublicLegalTexts = Omit<
  sharedContract.PublicLegalTextsResponse,
  "agb_display_mode" | "blocks" | "health_consent"
> & {
  agb_display_mode?: LegalBlockDisplayMode;
  blocks: PublicLegalBlock[];
  health_consent?: PublicLegalBlock;
};

/**
 * Fetches the per-tenant legal documents. Unconfigured texts come back
 * as empty strings and produce no legal block. A non-OK response
 * (settings/DB/JSON failure) THROWS rather than returning null: the
 * caller must fail closed instead of collecting an incomplete legal state.
 */
export async function fetchPublicLegalTexts(
  tenantSlug: string,
  phaseId?: string,
  options: { lateInviteToken?: string } = {},
): Promise<PublicLegalTexts> {
  const query = { late_invite: options.lateInviteToken?.trim() || undefined };
  const errorMessage = "Rechtstexte konnten nicht geladen werden";
  // The phase is a path segment, as the backend serves it (#2352).
  return publicLegalTextsFromContract(
    phaseId
      ? await bffJson(
          "public",
          "GET /api/enrollment/legal/{tenantSlug}/{phaseId}",
          { params: { tenantSlug, phaseId }, query, errorMessage },
        )
      : await bffJson("public", "GET /api/enrollment/legal/{tenantSlug}", {
          params: { tenantSlug },
          query,
          errorMessage,
        }),
  );
}

/**
 * Creates a new named schema (version 1). Backend rejects when a
 * schema with the same name already exists. Use updateSchema in
 * that case.
 */
export async function createSchema(
  name: string,
  fields: FormField[],
  coreRequirements: CoreRequirements = {},
  legalBlocks?: FormLegalBlock[],
): Promise<FormSchema> {
  const body =
    legalBlocks === undefined
      ? { name, fields, core_requirements: coreRequirements }
      : {
          name,
          fields,
          core_requirements: coreRequirements,
          legal_blocks: legalBlocks,
        };
  return formSchemaFromContract(
    await bffJson("tenant", "POST /api/enrollment/schema/", {
      body,
      errorMessage: "Formularvorlage konnte nicht erstellt werden",
    }).catch((error: unknown) =>
      logEnrollmentFailure(error, logger, "schema_create_failed"),
    ),
  );
}

/**
 * Publishes a new version of an existing named schema. The new row
 * inherits the source schema's name and uses max(version)+1 for that
 * name. Older versions stay in place for historical submissions, and
 * phases using an older version of this template are moved to the new
 * schema_id.
 *
 * Pass `newName` to rename the whole lineage AND publish the new version
 * in ONE backend transaction (a combined "rename + edit" save). A failed
 * publish rolls the rename back, so there is no partial "renamed but
 * content unchanged" state. A 409 (`enrollment.schema_name_exists`) is
 * raised when the new name already identifies a different schema.
 */
export async function updateSchema(
  id: string,
  fields: FormField[],
  coreRequirements?: CoreRequirements,
  legalBlocks?: FormLegalBlock[],
  newName?: string,
): Promise<FormSchema> {
  const body: enrollmentContract.UpdateSchemaRequest = { fields };
  if (newName !== undefined) body.name = newName;
  if (coreRequirements !== undefined) body.core_requirements = coreRequirements;
  if (legalBlocks !== undefined) body.legal_blocks = legalBlocks;
  return formSchemaFromContract(
    await bffJson("tenant", "PUT /api/enrollment/schema/{id}", {
      params: { id },
      body,
      errorMessage: "Formularvorlage konnte nicht gespeichert werden",
    }).catch((error: unknown) =>
      logEnrollmentFailure(error, logger, "schema_update_failed"),
    ),
  );
}

export async function uploadEnrollmentLegalDocument(
  file: File,
): Promise<string> {
  const body = new FormData();
  body.append("document", file);
  const { document_url: documentURL } = await bffJson(
    "tenant",
    "POST /api/enrollment/legal-documents",
    { body, errorMessage: "PDF-Datei konnte nicht hochgeladen werden" },
  );
  return documentURL;
}

export async function deleteEnrollmentLegalDocument(
  documentURL: string,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const filename = documentURL.trim().split("/").pop();
  if (!filename) return;

  await bffJson("tenant", "DELETE /api/enrollment/legal-documents/{filename}", {
    params: { filename },
    errorMessage: "PDF-Datei konnte nicht entfernt werden",
    // The draft's PDF goes when the page goes (pagehide): only a keepalive
    // request outlives it.
    ...(options.keepalive && { keepalive: true }),
  });
}

/**
 * Renames a logical schema. Every version row sharing the source's name
 * is renamed atomically, so the whole version lineage keeps one shared
 * name. This publishes no new version and leaves the form fields
 * untouched. The backend rejects (409) a name already used by a
 * different schema.
 */
export async function renameSchema(
  id: string,
  name: string,
): Promise<FormSchema> {
  return formSchemaFromContract(
    await bffJson("tenant", "PATCH /api/enrollment/schema/{id}", {
      params: { id },
      body: { name },
      errorMessage: "Formularvorlage konnte nicht umbenannt werden",
    }),
  );
}

export async function deleteSchema(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/enrollment/schema/{id}", {
    params: { id },
    errorMessage: "Formularvorlage konnte nicht gelöscht werden",
  });
}

/** Convenience: returns a fresh, blank field with sensible defaults. */
export function blankField(sortOrder: number): FormField {
  return {
    key: "",
    label: "",
    type: "text",
    required: false,
    sort_order: sortOrder,
    applies_to_child: false,
  };
}

/**
 * Convenience: returns a fresh, blank information block. Info blocks
 * collect no answer, so they carry a generated key (the admin never
 * sees it) and a body in `content`. The key is finalised on save.
 */
export function blankInfoField(sortOrder: number): FormField {
  return {
    key: "",
    label: "",
    type: "information",
    content: "",
    required: false,
    sort_order: sortOrder,
    applies_to_child: false,
  };
}

// --- Reading the contract ---------------------------------------------
//
// Narrows the form schema of the contract (open enums, translation records
// that may hold null) into the form types of the online registration (#2353).
// Every reader of these types may save the whole form back, so a value this
// build does not know fails the read instead of being guessed or dropped.

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

/**
 * A legal block of a form schema. An unknown kind, source or display mode
 * fails the read for the same reasons as an unknown field type.
 */
function legalBlockFromContract(
  block: sharedContract.FormLegalBlock,
  at: string,
): FormLegalBlock {
  const {
    kind,
    source,
    display_mode: displayMode,
    translations,
    ...rest
  } = block;
  return {
    ...rest,
    kind: requiredEnum(LEGAL_BLOCK_KINDS, kind, `${at}.kind`),
    ...(source === undefined
      ? {}
      : { source: requiredEnum(LEGAL_BLOCK_SOURCES, source, `${at}.source`) }),
    ...(displayMode === undefined
      ? {}
      : {
          display_mode: requiredEnum(
            LEGAL_BLOCK_DISPLAY_MODES,
            displayMode,
            `${at}.display_mode`,
          ),
        }),
    ...(translations === undefined
      ? {}
      : { translations: translationsFromContract(translations) }),
  };
}

// Go does not register the keys; the contract types them as string.
const CORE_REQUIREMENT_KEYS = [
  "guardian_phone",
  "signature",
  "holiday_care_wish",
] as const satisfies readonly CoreRequirementKey[];

/** The rules of the base form; a rule this build does not know is left out. */
function coreRequirementsFromContract(
  requirements: Record<string, boolean> | null,
): CoreRequirements | undefined {
  if (!requirements) return undefined;
  return Object.fromEntries(
    CORE_REQUIREMENT_KEYS.flatMap((key) =>
      key in requirements ? [[key, requirements[key] === true]] : [],
    ),
  );
}

/** A form schema version; see `formFieldFromContract`. */
export function formSchemaFromContract(
  schema: enrollmentContract.FormSchemaResponse,
): FormSchema {
  const {
    fields,
    core_requirements: coreRequirements,
    legal_blocks: legalBlocks,
    ...rest
  } = schema;
  const core = coreRequirementsFromContract(coreRequirements);
  return {
    ...rest,
    fields: (fields ?? []).map((field, index) =>
      formFieldFromContract(field, `FormSchema.fields.${index}`),
    ),
    ...(core && { core_requirements: core }),
    ...(legalBlocks && {
      legal_blocks: legalBlocks.map((block, index) =>
        legalBlockFromContract(block, `FormSchema.legal_blocks.${index}`),
      ),
    }),
  };
}

/** The active schema of the parent form. */
export function publicFormSchemaFromContract(
  schema: sharedContract.PublicFormSchemaResponse,
): PublicFormSchema {
  const core = coreRequirementsFromContract(schema.core_requirements);
  return {
    id: schema.id,
    version: schema.version,
    fields: (schema.fields ?? []).map((field, index) =>
      formFieldFromContract(field, `PublicFormSchema.fields.${index}`),
    ),
    ...(core && { core_requirements: core }),
  };
}

/** A legal block of the public form. */
export function publicLegalBlockFromContract(
  block: sharedContract.LegalBlock,
  at: string,
): PublicLegalBlock {
  const { kind, source, translations, ...rest } = block;
  return {
    ...rest,
    kind: requiredEnum(LEGAL_BLOCK_KINDS, kind, `${at}.kind`),
    ...(source === undefined
      ? {}
      : { source: requiredEnum(LEGAL_BLOCK_SOURCES, source, `${at}.source`) }),
    ...(translations === undefined
      ? {}
      : { translations: translationsFromContract(translations) }),
  };
}

/** The legal texts and blocks of the public form. */
export function publicLegalTextsFromContract(
  texts: sharedContract.PublicLegalTextsResponse,
): PublicLegalTexts {
  const {
    agb_display_mode: agbDisplayMode,
    blocks,
    health_consent: healthConsent,
    ...rest
  } = texts;
  return {
    ...rest,
    ...(agbDisplayMode && {
      agb_display_mode: requiredEnum(
        LEGAL_BLOCK_DISPLAY_MODES,
        agbDisplayMode,
        "PublicLegalTexts.agb_display_mode",
      ),
    }),
    blocks: (blocks ?? []).map((block, index) =>
      publicLegalBlockFromContract(block, `PublicLegalTexts.blocks.${index}`),
    ),
    ...(healthConsent && {
      health_consent: publicLegalBlockFromContract(
        healthConsent,
        "PublicLegalTexts.health_consent",
      ),
    }),
  };
}
