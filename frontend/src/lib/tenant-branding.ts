export interface TenantSettings {
  logoUrl?: string;
  loginImageUrl?: string;
  primaryColor?: string;
  [key: string]: unknown;
}

/** Bad optional branding must not hide a school or discard its other settings. */
export function parseTenantSettings(value: unknown): TenantSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const settings: TenantSettings = { ...value };
  for (const key of ["logoUrl", "loginImageUrl", "primaryColor"] as const) {
    if (typeof settings[key] !== "string") delete settings[key];
  }
  return settings;
}
