"use client";

import { useCallback, useState } from "react";
import {
  AdminEnrollmentsList,
  type AdminEnrollmentsSummary,
} from "~/components/enrollment/admin-enrollments-list";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { DesktopOnlyNotice } from "~/components/ui/desktop-only-notice";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import { PhaseExpiryWarnings } from "~/components/enrollment/phase-expiry-warnings";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { markAllAdminRequestsRead } from "~/lib/enrollment-admin-api";
import {
  fetchEmailSubscription,
  setEmailSubscription,
} from "~/lib/notification-preferences-api";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

/** E-Mail „Neue Anmeldung" an die Person selbst, zum Einschalten (#3780). */
const ENROLLMENT_EMAIL = "enrollment_submitted";

export default function AdminEnrollmentsPage() {
  // Jede Anmeldungsroute verlangt config:manage (#3469).
  const { isReady } = useRequirePermission("config:manage");
  // Statuszeile des Seitenkopfs: die Zahlen, die die Liste ohnehin lädt.
  const [summary, setSummary] = useState<
    AdminEnrollmentsSummary | "unavailable" | null
  >(null);
  const { success: toastSuccess } = useToast();
  const { show: showError } = useApiErrorDisplay();
  // Lesestatus pro Person (#3778): markiert die ungelesenen Anmeldungen der
  // aktiven Phasen für die angemeldete Person.
  const invalidateFamily = useInvalidateFamily();
  const handleMarkAllRead = useCallback(() => {
    markAllAdminRequestsRead()
      .then(() => {
        void invalidateFamily(enrollmentKeys.adminRequestsFamily);
        toastSuccess("Alle Anmeldungen sind als gelesen markiert.");
      })
      .catch((err: unknown) => {
        void showError(err, { object: "die Markierung als gelesen" });
      });
  }, [invalidateFamily, toastSuccess, showError]);
  // Eigener Stand der E-Mail bei neuer Anmeldung. Lässt er sich nicht laden,
  // fehlt der Eintrag, statt einen falschen Haken zu zeigen.
  const subscription = useSWRAuth(
    isReady ? tenantAdminKeys.emailSubscription(ENROLLMENT_EMAIL) : null,
    () => fetchEmailSubscription(ENROLLMENT_EMAIL),
  );
  // The value being saved; the menu shows it until the save settles.
  const [saving, setSaving] = useState<boolean | null>(null);
  const emailSaving = saving !== null;
  const enabled = saving ?? subscription.data;
  const emailState =
    enabled !== undefined
      ? enabled
        ? "on"
        : "off"
      : subscription.error
        ? "unavailable"
        : "loading";
  const { mutate: mutateSubscription } = subscription;
  const handleToggleEmail = useCallback(async () => {
    if (emailSaving || (emailState !== "on" && emailState !== "off")) return;
    const next = emailState === "off";
    setSaving(next);
    try {
      await setEmailSubscription(ENROLLMENT_EMAIL, next);
    } catch (err) {
      void showError(err, { object: "die E-Mail-Einstellung" });
      setSaving(null);
      return;
    }
    await mutateSubscription(next, { revalidate: false });
    setSaving(null);
    toastSuccess(
      next
        ? "Sie bekommen jetzt bei jeder neuen Anmeldung eine E-Mail."
        : "Sie bekommen keine E-Mail mehr bei neuen Anmeldungen.",
    );
  }, [emailState, emailSaving, mutateSubscription, toastSuccess, showError]);
  const handleSummaryChange = useCallback(
    (next: AdminEnrollmentsSummary | "unavailable" | null) => setSummary(next),
    [],
  );
  const statusLine =
    summary && summary !== "unavailable" ? (
      <TenantPageStats
        items={[
          {
            value: summary.activePhases,
            label: `${summary.activePhases === 1 ? "Phase" : "Phasen"} aktiv`,
          },
          {
            value: summary.requests,
            label: summary.requests === 1 ? "Anmeldung" : "Anmeldungen",
          },
          ...(summary.openChangeRequests !== null &&
          summary.openChangeRequests > 0
            ? [
                {
                  value: summary.openChangeRequests,
                  label: `offene ${summary.openChangeRequests === 1 ? "Änderungsanfrage" : "Änderungsanfragen"}`,
                },
              ]
            : []),
        ]}
      />
    ) : null;

  return (
    <TenantPage
      title="Überblick"
      stats={statusLine}
      statsLoading={summary === null}
      loading={!isReady}
      actions={
        <OverflowMenu
          ariaLabel="Weitere Aktionen für Anmeldungen"
          items={[
            {
              label: "Alle als gelesen markieren",
              description: "Markiert alle Anmeldungen nur für Sie als gelesen.",
              onClick: handleMarkAllRead,
            },
            ...(emailState === "unavailable"
              ? []
              : [
                  { kind: "separator" } as const,
                  {
                    kind: "checkbox" as const,
                    label: "E-Mail an mich bei neuer Anmeldung",
                    checked: emailState === "on",
                    disabled: emailState === "loading" || emailSaving,
                    onClick: () => void handleToggleEmail(),
                  },
                ]),
          ]}
        />
      }
    >
      <DesktopOnlyNotice />
      <PhaseExpiryWarnings />
      {/* Flex-Spalte, damit die letzte Fläche bis zur Unterkante wächst
          (`.moto-tenant-body`). */}
      <div className="hidden lg:flex lg:flex-col">
        <AdminEnrollmentsList onSummaryChange={handleSummaryChange} />
      </div>
    </TenantPage>
  );
}
