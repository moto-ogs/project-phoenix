"use client";

import { Suspense, use, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createLogger } from "~/lib/logger";
import { formatDate } from "~/lib/date-helpers";
import { applyOptimisticSchemaUpdate } from "~/lib/settings-api";
import {
  fetchOperatorSettingsSchema,
  setOperatorSettingValue,
  resetOperatorSettingValue,
  revealOperatorSettingValue,
} from "~/lib/operator/operator-settings-api";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import { resolveOperatorBackHref } from "~/lib/operator/back-href";
import { SettingsCategory } from "~/components/settings/settings-category";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import {
  useSwrLoadError,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { useAccessControlledData } from "~/lib/hooks/use-access-controlled-data";
import { useSWRAuth } from "~/lib/swr";
import { operatorKeys } from "~/lib/swr/operator-keys";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";
import { ConfirmationModal } from "~/components/ui/modal";
import { useBookingAuthorityImpact } from "./use-booking-authority-impact";
import { EmptyState } from "~/components/ui/empty-state";
import { TenantPage } from "~/components/ui/tenant-page";
import { SectionCard } from "~/components/ui/section-card";
import type { MotoConcept } from "~/lib/moto-concepts";
import { settingsConcept } from "~/lib/concepts/settings";
import { devicesConcept } from "~/lib/concepts/devices";
import { notificationsConcept } from "~/lib/concepts/notifications";
import { permissionsConcept } from "~/lib/concepts/permissions";

const logger = createLogger({ component: "OperatorSchoolSettingsPage" });

// Tab labels (match the tenant settings UI mapping)
const TAB_LABELS: Record<string, string> = {
  operations: "Betrieb",
  reminders: "Erinnerungen",
  gdpr: "Datenschutz",
  security: "Sicherheit",
  devices: "Geräte",
  system: "System",
  general: "Allgemein",
  startseite: "Startseite für alle",
  modules: "Module",
};

// Konzept je Einstellungs-Tab, fuer die Kachel im Sektions-Header. Faellt auf
// das neutrale "settings"-Konzept zurueck, wenn kein spezifischeres passt.
const TAB_CONCEPTS: Record<string, MotoConcept> = {
  operations: settingsConcept,
  reminders: notificationsConcept,
  gdpr: permissionsConcept,
  security: permissionsConcept,
  devices: devicesConcept,
  system: settingsConcept,
  general: settingsConcept,
};

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default function OperatorSchoolSettingsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <OperatorSchoolSettingsPageContent params={params} />
    </Suspense>
  );
}

function OperatorSchoolSettingsPageContent({ params }: PageProps) {
  const { id: schoolId } = use(params);
  const searchParams = useSearchParams();
  const backHref = useMemo(
    () =>
      resolveOperatorBackHref(searchParams.get("back"), "/operator/schools"),
    [searchParams],
  );
  const backLabel =
    backHref === "/operator/schools"
      ? "Zurück zu den Schulen"
      : "Zurück zur Schule";

  const schemaKey = operatorKeys.schoolSettingsSchema(schoolId);
  const {
    data: cachedSchema,
    error: schemaError,
    mutate: mutateSchema,
  } = useSWRAuth(schemaKey, () => fetchOperatorSettingsSchema(schoolId), {
    keepPreviousData: false,
  });
  // A refused read drops the shown values instead of offering their fields.
  const { data: schema } = useAccessControlledData(
    schemaKey,
    cachedSchema,
    schemaError,
  );
  // A failed refresh after a save keeps the shown values and reports the
  // stale list, so the error shows also while data is there.
  const schemaLoadError = useSwrLoadError(
    schemaError,
    "die Liste der Einstellungen",
    () => mutateSchema(),
  );
  const loading = !schema && !schemaError;

  // The heading names the school; a failed lookup is shown in place (#2519).
  const {
    data: schools,
    error: schoolsError,
    mutate: reloadSchools,
  } = useSWRAuth(
    operatorProvisioningKeys.schools(),
    () => operatorProvisioningService.listSchools(),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );
  const schoolNameLoad = useSwrResourceLoadError(
    [{ data: schools, error: schoolsError }],
    "die Bezeichnung der Schule",
    () => reloadSchools(),
  );
  const schoolName =
    schools?.find((school) => school.id === schoolId)?.name ?? "";

  // Save and reset throw the ApiError of a failed request; the field shows
  // it on the shared error path (#2519).
  const handleSave = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      await setOperatorSettingValue(schoolId, key, value);
      logger.info("operator_setting_saved", { school_id: schoolId, key });
      // The saved value shows at once, as on the school page: a stale field
      // would offer „Zurücksetzen“ for a value just saved (#7218).
      await mutateSchema(
        (current) =>
          current ? applyOptimisticSchemaUpdate(current, key, value) : current,
        { revalidate: false },
      );
      void mutateSchema();
    },
    [schoolId, mutateSchema],
  );

  const handleReset = useCallback(
    async (key: string): Promise<void> => {
      await resetOperatorSettingValue(schoolId, key);
      logger.info("operator_setting_reset", { school_id: schoolId, key });
      void mutateSchema();
    },
    [schoolId, mutateSchema],
  );

  const handleReveal = useCallback(
    (key: string) => revealOperatorSettingValue(schoolId, key),
    [schoolId],
  );

  const bookingAuthority = useBookingAuthorityImpact(schoolId, handleSave);
  const bookingAuthorityBlockers =
    bookingAuthority.state.impact?.blockingChildren ?? [];

  return (
    <TenantPage
      title={`Einstellungen${schoolName ? ` · ${schoolName}` : ""}`}
      back
      backHref={backHref}
      backLabel={backLabel}
      info="Sie bearbeiten diese Einstellungen als Operator stellvertretend für die Schule."
      loading={loading}
      loadingLabel="Einstellungen werden geladen…"
      overlays={
        <ConfirmationModal
          isOpen={bookingAuthority.state.isOpen}
          onClose={bookingAuthority.close}
          onConfirm={() => void bookingAuthority.confirm()}
          title="Buchungsmodus aktivieren?"
          confirmText="Buchungsmodus aktivieren"
          cancelText="Abbrechen"
          isConfirmLoading={bookingAuthority.state.isSaving}
          loadingText="Wird aktiviert …"
          isConfirmDisabled={
            bookingAuthority.state.isLoading ||
            bookingAuthority.state.impact === null ||
            bookingAuthorityBlockers.length > 0 ||
            bookingAuthority.loadError !== null
          }
        >
          <div className="space-y-4 text-sm text-gray-700">
            <p>
              Nach dem Aktivieren bestimmen die Buchungen, an welchen Tagen die
              Kinder betreut werden.
            </p>
            {bookingAuthority.state.isLoading ? (
              <p>Auswirkungen werden geprüft …</p>
            ) : null}
            <LoadErrorAlert error={bookingAuthority.loadError} />
            <FormErrorAlert message={bookingAuthority.saveError} />
            {bookingAuthority.state.impact &&
            bookingAuthorityBlockers.length > 0 ? (
              <div>
                <p className="font-medium text-gray-900">
                  Aktivieren nicht möglich: Für{" "}
                  {bookingAuthorityBlockers.length}
                  {bookingAuthorityBlockers.length === 1
                    ? " Kind ist aktuell keine Betreuung gebucht."
                    : " Kinder sind aktuell keine Betreuung gebucht."}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {bookingAuthorityBlockers.map((child) => (
                    <li key={child.studentId}>
                      {child.firstName} {child.lastName}
                      {child.schoolClass ? " · " + child.schoolClass : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  Bitte klären Sie diese Buchungen zuerst. Das Aktivieren kann
                  nicht übersprungen werden.
                </p>
              </div>
            ) : null}
            {bookingAuthority.state.impact &&
            bookingAuthorityBlockers.length === 0 ? (
              <p className="font-medium text-gray-900">
                Alle aktuell betreuten Kinder haben mindestens einen gebuchten
                Betreuungstag.
              </p>
            ) : null}
            {bookingAuthority.state.impact ? (
              <div>
                <p className="font-medium text-gray-900">
                  Geplante Abschlüsse:{" "}
                  {bookingAuthority.state.impact.plannedCompletions.length}
                </p>
                {bookingAuthority.state.impact.plannedCompletions.length ===
                0 ? (
                  <p className="mt-1">Es werden keine Abschlüsse geplant.</p>
                ) : (
                  <>
                    <p className="mt-1">
                      moto legt diese Abschlüsse sofort an. Die Kinder bleiben
                      bis zum letzten gebuchten Betreuungstag in den
                      Arbeitslisten.
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {bookingAuthority.state.impact.plannedCompletions.map(
                        (child) => (
                          <li key={child.studentId}>
                            {child.firstName} {child.lastName}
                            {child.firstBookinglessDay
                              ? " · ab " + formatDate(child.firstBookinglessDay)
                              : ""}
                          </li>
                        ),
                      )}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </ConfirmationModal>
      }
    >
      <LoadErrorAlert error={schoolNameLoad.error} />
      <LoadErrorAlert error={schemaLoadError} />

      {schema && (schema.tabs?.length ?? 0) === 0 ? (
        <SectionCard>
          <EmptyState title="Keine Einstellungen für diese Schule verfügbar." />
        </SectionCard>
      ) : null}

      {schema?.tabs?.map((tab) => (
        <SectionCard
          key={tab.key}
          bare
          title={TAB_LABELS[tab.key] ?? tab.label}
          concept={TAB_CONCEPTS[tab.key] ?? settingsConcept}
        >
          <div className="space-y-6">
            {tab.categories.map((category) => (
              <SettingsCategory
                key={category.key}
                category={category}
                onSave={handleSave}
                onReset={handleReset}
                onBookingAuthorityEnable={bookingAuthority.request}
                audience="operator"
                revealFn={handleReveal}
              />
            ))}
          </div>
        </SectionCard>
      ))}
    </TenantPage>
  );
}
