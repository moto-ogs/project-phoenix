import type { SchemaTab } from "./settings-api";

export const ENROLLMENT_ENABLED_KEY = "enrollment.enabled";
const ENROLLMENT_PRIVACY_NOTICE_SWITCH_KEY = "enrollment.legal_dsgvo_enabled";
const ENROLLMENT_PRIVACY_NOTICE_TEXT_KEY = "enrollment.legal_dsgvo_text";
export const ENROLLMENT_NOTIFICATION_EMAILS_KEY =
  "enrollment.notification_emails";

/**
 * The settings link that opens the privacy notice of the enrollment form. It
 * highlights the switch, not the text: the text field stays hidden while the
 * switch is off, and switching it on asks for the text.
 */
export const ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH = `/settings?tab=enrollment&highlight=${ENROLLMENT_PRIVACY_NOTICE_SWITCH_KEY}`;

/** Names who may write the notice, for people who may not. */
export const ENROLLMENT_PRIVACY_NOTICE_WHO_ACTS =
  "Eintragen kann sie eine Person mit dem Recht „Alle Einstellungen der Schule ändern“.";

export interface EnrollmentPrivacyNoticeState {
  readonly enrollmentEnabled: boolean;
  /**
   * The public form shows the privacy notice (Art. 13 DSGVO): its switch is
   * on and its text is not blank. Mirrors the backend check that refuses to
   * switch the online enrollment on without it (#7176).
   */
  readonly noticePresent: boolean;
  /** The stored recipients of new-enrollment e-mails, empty for none. */
  readonly notificationRecipients: string;
}

/**
 * Reads whether the online enrollment runs and whether parents see a privacy
 * notice, from the effective values of the settings schema (school value,
 * else Träger value, else default). Null without the enrollment tab.
 */
export function enrollmentPrivacyNotice(
  tabs: readonly SchemaTab[] | null | undefined,
): EnrollmentPrivacyNoticeState | null {
  const tab = tabs?.find((candidate) => candidate.key === "enrollment");
  if (!tab) return null;
  const values = new Map<string, unknown>();
  for (const category of tab.categories) {
    for (const item of category.items) values.set(item.key, item.value);
  }
  const text = values.get(ENROLLMENT_PRIVACY_NOTICE_TEXT_KEY);
  const recipients = values.get(ENROLLMENT_NOTIFICATION_EMAILS_KEY);
  return {
    notificationRecipients: typeof recipients === "string" ? recipients : "",
    enrollmentEnabled: values.get(ENROLLMENT_ENABLED_KEY) === true,
    noticePresent:
      values.get(ENROLLMENT_PRIVACY_NOTICE_SWITCH_KEY) === true &&
      typeof text === "string" &&
      text.trim() !== "",
  };
}
