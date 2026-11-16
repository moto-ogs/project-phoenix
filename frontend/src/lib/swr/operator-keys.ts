/**
 * Operator- und Caterer-Portal: Schulen, Konten, Einstellungen.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const operatorKeys = {
  /** System roles an operator can assign to a new school account. */
  systemRoles: () => "operator-system-roles",
  traegerStaffRelease: (organizationId: string) =>
    `operator-org-traeger-staff-release-${encodeURIComponent(organizationId)}`,
  /** The operator settings schema of one school, with its values. */
  schoolSettingsSchema: (schoolId: string) =>
    `operator-school-settings-schema-${encodeURIComponent(schoolId)}`,
  /** The signed-in operator's own profile. */
  profile: () => "operator-profile",
  /** Whether a device can move to another school now (online, session). */
  deviceTransferStatus: (deviceId: string) =>
    `operator-device-transfer-status-${encodeURIComponent(deviceId)}`,
  /** One account's account-wide second-factor override (`operatorAdminGetGlobalMFAOverride`). */
  accountGlobalMfaOverride: (accountId: string) =>
    `operator-account-global-mfa-override-${encodeURIComponent(accountId)}`,
} as const;
