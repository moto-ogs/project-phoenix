import { tenantShellSettingKeys } from "./contract/tenant-shell-settings.generated";

/** Wire syntax for the settings key segment; Go owns key and value semantics. */
export const SETTINGS_KEY_SEGMENT = /^[a-z0-9_.]{1,255}$/;

/** Lookup settings whose writes must invalidate the tenant shell. */
export const TENANT_RESOLVE_AFFECTING_KEYS: ReadonlySet<string> = new Set(
  tenantShellSettingKeys,
);

export const OPERATIONAL_OVERVIEW_SETTING =
  "operations.operational_overview_scope";
