"use client";

import { useSession } from "next-auth/react";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { hasPermission } from "~/lib/auth-utils";
import {
  ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH,
  type EnrollmentPrivacyNoticeState,
} from "~/lib/enrollment-privacy-notice";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Warns a school whose online enrollment runs without a privacy notice
 * (#7176). Schools that switched the form on before the backend required the
 * notice keep their form online; this warning stays until the notice is
 * there and cannot be closed. Only people who may change the settings
 * (`config:update`) see it; the link appears only for those who may write the
 * notice (`config:manage`).
 */
export function EnrollmentPrivacyNoticeWarning({
  state,
}: Readonly<{ state: EnrollmentPrivacyNoticeState | null }>) {
  const { data: session } = useSession();
  const tenantPath = useTenantAwarePath();
  if (!state?.enrollmentEnabled || state.noticePresent) return null;
  if (!hasPermission(session, "config:update")) return null;
  const canWriteNotice = hasPermission(session, "config:manage");

  return (
    <Alert
      type="warning"
      title="Datenschutzinformation fehlt"
      message={
        canWriteNotice
          ? "Die Online-Anmeldung ist eingeschaltet. Eltern sehen dort aber keine Datenschutzinformation. Bitte tragen Sie sie ein und schalten Sie sie an."
          : "Die Online-Anmeldung ist eingeschaltet. Eltern sehen dort aber keine Datenschutzinformation. Eintragen kann sie eine Person mit dem Recht „Alle Einstellungen der Schule ändern“."
      }
      action={
        canWriteNotice ? (
          <ButtonLink
            href={tenantPath(ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH)}
            variant="surface"
            size="compact"
            tooltip="Öffnet die Datenschutzinformation in den Einstellungen."
          >
            Zur Datenschutzinformation
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
