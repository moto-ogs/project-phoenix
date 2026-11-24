import { knownEnum } from "./contract/known-enum";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as wire from "./contract/shared.generated";
import { createLogger } from "./logger";
import { shellResourceKeys } from "./swr/shell-keys";

const logger = createLogger({ component: "SettingsApi" });

/** The schema's SWR key; readers use `shellResourceKeys.settingsSchema()`. */
export const SETTINGS_SCHEMA_SWR_KEY = shellResourceKeys.settingsSchema();

// --- Types ---

export interface SettingsSchema {
  tabs: SchemaTab[];
}

export interface SchemaTab {
  key: string;
  label: string;
  categories: SchemaCategory[];
}

export interface SchemaCategory {
  key: string;
  label: string;
  items: ResolvedSetting[];
}

const accessPolicies = [
  "shared",
  "admin_only",
  "operator_only",
  "operator_managed",
] as const;
const settingLevels = ["schule", "beide", "traeger"] as const;
const settingSources = ["default", "traeger", "school"] as const;
const settingTypes = [
  "boolean",
  "number",
  "time",
  "date",
  "text",
  "textarea",
  "color",
  "password",
  "select",
  "multiselect",
] as const;

type Nullable<T> = { [K in keyof T]: T[K] | null };

/**
 * One setting of the schema, with its closed value sets known. `is_default`:
 * school schema: the school has no value of its own, so a reset changes
 * nothing (booleans: the value equals the inherited one); Träger schema: the
 * Träger has no value. `placeholder` is the grey example of an empty
 * textarea, never a value (#5693). `traeger_changed_at` is the last change of
 * the Träger value; it stays set beneath a school deviation.
 */
export type ResolvedSetting = Omit<
  wire.ResolvedSetting,
  | "type"
  | "access_policy"
  | "levels"
  | "source"
  | "traeger_changed_at"
  | "validation"
  | "depends_on"
  | "options"
> &
  Partial<
    Nullable<
      Pick<
        wire.ResolvedSetting,
        "traeger_changed_at" | "validation" | "depends_on" | "options"
      >
    >
  > & {
    type: (typeof settingTypes)[number];
    access_policy: (typeof accessPolicies)[number];
    levels: (typeof settingLevels)[number];
    source: (typeof settingSources)[number];
  };

function toResolvedSetting(
  item: wire.ResolvedSetting,
): ResolvedSetting | undefined {
  const type = knownEnum(settingTypes, item.type);
  const access_policy = knownEnum(accessPolicies, item.access_policy);
  const levels = knownEnum(settingLevels, item.levels);
  const source = knownEnum(settingSources, item.source);
  // Do not offer editing controls whose type or scope this release cannot interpret.
  if (!type || !access_policy || !levels || !source) return undefined;
  return { ...item, type, access_policy, levels, source };
}

// --- Optimistic Update Helper ---

/**
 * The value a boolean falls back to without the school's own value: the
 * default, or the Träger value where there is one (ADR 0086). The schema
 * carries no Träger value of its own; for a boolean it is the current value
 * while it comes from the Träger or equals it, and its opposite otherwise.
 */
function inheritedBooleanValue(item: ResolvedSetting): unknown {
  if (!item.traeger_changed_at || typeof item.value !== "boolean") {
    return item.default;
  }
  if (item.source === "traeger" || item.is_default) return item.value;
  return !item.value;
}

/**
 * Returns a new schema with `key` set to `value` and every entry's `visible`
 * flag re-evaluated against its `depends_on` rule. Pure — does not mutate the
 * input. Used as the optimistic-data argument to SWR's mutate so the UI
 * reflects the change before the server confirms.
 */
export function applyOptimisticSchemaUpdate(
  schema: SettingsSchema,
  key: string,
  value: unknown,
): SettingsSchema {
  const valueMap = new Map<string, unknown>();
  const itemMap = new Map<string, ResolvedSetting>();
  for (const tab of schema.tabs) {
    for (const cat of tab.categories) {
      for (const item of cat.items) {
        valueMap.set(item.key, item.key === key ? value : item.value);
        itemMap.set(item.key, item);
      }
    }
  }

  const visibilityMemo = new Map<string, boolean>();
  const evaluateVisibility = (
    item: ResolvedSetting,
    visiting = new Set<string>(),
  ): boolean => {
    const cached = visibilityMemo.get(item.key);
    if (cached !== undefined) return cached;
    if (!item.depends_on) {
      visibilityMemo.set(item.key, true);
      return true;
    }
    if (visiting.has(item.key)) {
      visibilityMemo.set(item.key, false);
      return false;
    }
    visiting.add(item.key);
    const parent = itemMap.get(item.depends_on.key);
    if (!parent || !evaluateVisibility(parent, visiting)) {
      visibilityMemo.set(item.key, false);
      visiting.delete(item.key);
      return false;
    }
    const parentVal = valueMap.get(item.depends_on.key);
    const cond = item.depends_on.condition;
    const expected = item.depends_on.value;
    let visible = true;
    if (cond === "eq") {
      visible = JSON.stringify(parentVal) === JSON.stringify(expected);
    } else if (cond === "neq") {
      visible = JSON.stringify(parentVal) !== JSON.stringify(expected);
    } else if (cond === "not_empty") {
      visible = parentVal != null && parentVal !== "";
    } else {
      visible = false;
    }
    visibilityMemo.set(item.key, visible);
    visiting.delete(item.key);
    return visible;
  };

  return {
    ...schema,
    tabs: schema.tabs.map((tab) => ({
      ...tab,
      categories: tab.categories.map((cat) => ({
        ...cat,
        items: cat.items.map((item) => {
          const optimisticValue = item.type === "password" ? "••••••" : value;
          // Mirror the backend's is_default semantics (issue #1680): boolean
          // toggles are value-based (no reset button, so toggling back to the
          // inherited value must restore the "Standard" badge without a
          // refetch). The inherited value is the Träger value where there is
          // one (ADR 0086), else the default. All other
          // types just got an override row written, so is_default is false
          // and the reset button stays available.
          const optimisticIsDefault =
            item.type === "boolean"
              ? JSON.stringify(value) ===
                JSON.stringify(inheritedBooleanValue(item))
              : false;
          const updated =
            item.key === key
              ? {
                  ...item,
                  value: optimisticValue,
                  is_default: optimisticIsDefault,
                  // A school save always writes the school's own value.
                  source: "school" as const,
                }
              : item;
          return { ...updated, visible: evaluateVisibility(updated) };
        }),
      })),
    })),
  };
}

// --- API Functions ---

/**
 * The schema as the screens read it, for every portal that loads one
 * (school, operator): Go's nil lists arrive as null. The
 * value sets of a setting (type, policy, levels, source) are the registry's,
 * which the backend renders verbatim; this build narrows them as before.
 */
export function toSettingsSchema(schema: wire.SettingsSchema): SettingsSchema {
  return {
    tabs: (schema.tabs ?? []).flatMap((tab) =>
      tab
        ? [
            {
              key: tab.key,
              label: tab.label,
              categories: (tab.categories ?? []).flatMap((category) =>
                category
                  ? [
                      {
                        key: category.key,
                        label: category.label,
                        items: (category.items ?? []).flatMap((item) => {
                          const mapped = item && toResolvedSetting(item);
                          return mapped ? [mapped] : [];
                        }),
                      },
                    ]
                  : [],
              ),
            },
          ]
        : [],
    ),
  };
}

/**
 * Fetch the settings schema. Returns null when no session is ready yet or the
 * account may not read settings (401/403, expected, no error logged).
 * Any other failure throws an ApiError (#2517): a network failure must not
 * look like "no settings for your role".
 */
export async function fetchSettingsSchema(): Promise<SettingsSchema | null> {
  try {
    return toSettingsSchema(
      await bffJson("tenant", "GET /api/settings/schema", {
        errorMessage: "Einstellungen konnten nicht geladen werden",
      }),
    );
  } catch (error) {
    // 401/403: not signed in yet or no permission, expected, not an error.
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    logger.error("fetch_settings_schema_failed", {
      status: error instanceof ApiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Save a setting value (#2517). Throws an ApiError with the backend code, so
 * the caller shows the catalog text on the shared error path.
 */
export async function saveSettingValue(
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await bffJson("tenant", "PUT /api/settings/values/{key}", {
      params: { key },
      body: { value },
      errorMessage: `Setting ${key} could not be saved`,
    });
  } catch (error) {
    logger.warn("save_setting_value_rejected", {
      key,
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/** Reset a setting to its default (#2517). Throws an ApiError on failure. */
export async function clearSettingValue(key: string): Promise<void> {
  try {
    await bffJson("tenant", "DELETE /api/settings/values/{key}", {
      params: { key },
      errorMessage: `Setting ${key} could not be reset`,
    });
  } catch (error) {
    logger.warn("clear_setting_value_rejected", {
      key,
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/**
 * Reveal the unmasked value of a password/PIN setting.
 * Returns the raw value, or null when the setting holds no text value.
 * A failed request throws an ApiError (#2517); the field shows it.
 */
export async function revealSettingValue(key: string): Promise<string | null> {
  try {
    const revealed = await bffJson(
      "tenant",
      "GET /api/settings/values/{key}/reveal",
      { params: { key }, errorMessage: `Setting ${key} could not be revealed` },
    );
    return typeof revealed.value === "string" ? revealed.value : null;
  } catch (error) {
    logger.warn("reveal_setting_value_failed", {
      key,
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/**
 * Why the school's tablets still need a device PIN of the school's own
 * (#7175): "missing" locks every sign-in at the tablet, "too_simple" is a PIN
 * that is easy to guess, such as the former default 1234. Null: nothing to do.
 */
export type DevicePinSetupReason = "missing" | "too_simple";

/**
 * Reads whether the school still needs a device PIN of its own while
 * NFC-Anwesenheit is booked. The backend answers only with config:manage and
 * never sends the PIN itself.
 */
export async function fetchDevicePinSetupReason(): Promise<DevicePinSetupReason | null> {
  const status = await bffJson("tenant", "GET /api/settings/device-pin-status");
  if (status.setup_required !== true) return null;
  // An unknown reason from a newer backend still asks for a PIN.
  return status.reason === "too_simple" ? "too_simple" : "missing";
}

/**
 * The school's contact address (#7176). Switching the online enrollment on
 * offers it as the recipient of new-enrollment e-mails. Empty when the school
 * has none. A failed request throws an ApiError.
 */
export async function fetchSchoolContactEmail(): Promise<string> {
  const contact = await bffJson(
    "tenant",
    "GET /api/settings/school-contact-email",
    { errorMessage: "School contact address could not be loaded" },
  );
  return contact.email ?? "";
}
