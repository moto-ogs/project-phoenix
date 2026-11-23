"use client";

import { Suspense, useMemo } from "react";
import { redirect, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Eye, Info } from "lucide-react";
import { StatusBadge } from "~/components/ui/status-badge";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { EnrollmentForm } from "~/components/enrollment/enrollment-form";
import { previewNeedsSchoolLegalTexts } from "~/components/enrollment/enrollment-form-consent";
import type { PreviewCareOfferings } from "~/components/enrollment/enrollment-form-config";
import {
  PublicEnrollmentBrand,
  PublicEnrollmentLocaleSwitcher,
  PublicEnrollmentPageShell,
  PublicEnrollmentSteps,
  PublicInfoCard,
} from "~/components/enrollment/public-enrollment-shell";
import { BackLink } from "~/components/ui/back-link";
import { ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { listPhases, type Phase } from "~/lib/enrollment-phase-api";
import { fetchPhasePreviewBootstrap } from "~/lib/enrollment-phase-preview-api";
import { useTenant } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { supportedGradeLevelMax } from "~/lib/grade-level";
import {
  fetchEnrollmentPreviewBootstrap,
  fetchPublicLegalTexts,
  schemaToPublicFormSchema,
  type FormSchema,
  type PublicFormSchema,
} from "~/lib/enrollment-form-schema-api";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { permissionsConcept } from "~/lib/concepts/permissions";
import { FormSkeleton, SkeletonRegion } from "~/components/ui/page-skeletons";
import { Skeleton } from "~/components/ui/skeleton";

const PHASE_GONE = new Error("Diese Anmeldephase gibt es nicht mehr.");

export default function EnrollmentPreviewPage() {
  const { status } = useSession();
  const tenantPath = useTenantAwarePath();
  // This public URL previews protected configuration, not a public form.
  if (status === "unauthenticated") return redirect(tenantPath("/"));
  return (
    <Suspense fallback={null}>
      <EnrollmentPreviewPageContent />
    </Suspense>
  );
}

function EnrollmentPreviewPageContent() {
  const searchParams = useSearchParams();
  // With a phase in the address the page previews that phase with its
  // offerings, whatever its state: the public link of an inactive or closed
  // phase shows parents only an error, so a school could not check its
  // offerings before opening the enrollment (#6044).
  const phaseId = searchParams.get("phaseId");
  const schemaId = searchParams.get("schemaId");
  const isBasePreview = searchParams.get("base") === "1";
  const { tenant, tenantSlug } = useTenant();
  const tenantPath = useTenantAwarePath();
  const resolvedGradeLevelMax = tenant?.gradeLevelMax;
  const gradeLevelMax = supportedGradeLevelMax(resolvedGradeLevelMax);
  // Without a template in the address there is nothing to load: a fixed
  // hint, not an API error.
  const missingSchema = !schemaId && !phaseId && !isBasePreview;
  // A preview saves nothing: it shows the cached template at once and reads
  // it again, so a school that just edited it sees the new version.
  const phasesRead = useSWRAuth(
    missingSchema ? null : enrollmentKeys.phases(),
    () => listPhases(),
    { shouldRetryOnError: false },
  );
  const phases = phasesRead.data;
  const requestedPhase = useMemo<Phase | null>(
    () =>
      phaseId
        ? (phases?.find((candidate) => candidate.id === phaseId) ?? null)
        : null,
    [phaseId, phases],
  );
  const phaseGone =
    phaseId !== null && phases !== undefined && requestedPhase === null;
  const phaseBootstrapRead = useSWRAuth(
    requestedPhase
      ? enrollmentKeys.phasePreviewBootstrap(
          requestedPhase.id,
          requestedPhase.form_schema_id ?? null,
        )
      : null,
    async () => {
      const result = await fetchPhasePreviewBootstrap({
        phaseId: requestedPhase?.id ?? "",
        schemaId: requestedPhase?.form_schema_id,
      });
      if (
        !result.phase_offerings ||
        typeof result.enrollment_enabled !== "boolean"
      ) {
        throw new Error("Phase preview configuration is missing");
      }
      return result;
    },
    { shouldRetryOnError: false },
  );
  const templateBootstrapRead = useSWRAuth(
    !missingSchema && !phaseId
      ? enrollmentKeys.formPreviewBootstrap(schemaId, isBasePreview)
      : null,
    () => fetchEnrollmentPreviewBootstrap({ schemaId, base: isBasePreview }),
    { shouldRetryOnError: false },
  );
  const phaseBootstrap = phaseBootstrapRead.data;
  const templateBootstrap = templateBootstrapRead.data;
  // The phase shows with its own configuration only, as one answer.
  const previewPhase = phaseBootstrap ? requestedPhase : null;
  const bootstrap = phaseId ? phaseBootstrap : templateBootstrap;
  const schema: FormSchema | null = bootstrap?.schema ?? null;
  const assignedPhaseCount = templateBootstrap?.assigned_phase_count ?? 0;
  const activeAssignedPhaseCount =
    templateBootstrap?.active_assigned_phase_count ?? 0;
  const enrollmentEnabled = phaseBootstrap?.enrollment_enabled === true;
  // The phases using this template, for the links to their parents' view.
  // null: the list could not be loaded; the page then names the menu path.
  // The phase links are a help, not the preview itself: without them the
  // page still shows the form and names the way to the phase.
  const assignedPhases = useMemo<Phase[] | null>(
    () =>
      phasesRead.error !== undefined
        ? null
        : (phases ?? []).filter((phase) =>
            isBasePreview && !schemaId
              ? !phase.form_schema_id
              : phase.form_schema_id === schemaId,
          ),
    [phasesRead.error, phases, isBasePreview, schemaId],
  );
  const offeringConfig = phaseBootstrap?.phase_offerings;
  const previewOfferings = useMemo<PreviewCareOfferings | undefined>(
    () =>
      offeringConfig
        ? {
            offerings: offeringConfig.offerings,
            careOfferingSelectionMode:
              offeringConfig.care_offering_selection_mode,
            eligibleGradeLevels: offeringConfig.eligible_grade_levels,
            schoolClass: offeringConfig.school_class,
            collectGradeLevel: offeringConfig.collect_grade_level,
            careOfferingsEnabled: offeringConfig.care_offerings_enabled,
          }
        : undefined,
    [offeringConfig],
  );
  const previewSchema = useMemo<PublicFormSchema | null>(() => {
    if (!schema) return null;
    return schemaToPublicFormSchema(schema);
  }, [schema]);

  // A template without legal blocks of its own shows the school's texts, as
  // the live form does. A failed read stops the preview instead of showing
  // a form without them.
  const needsSchoolLegalTexts =
    bootstrap !== undefined && previewNeedsSchoolLegalTexts(previewSchema);
  const legalRead = useSWRAuth(
    needsSchoolLegalTexts ? enrollmentKeys.publicLegalTexts(tenantSlug) : null,
    () => fetchPublicLegalTexts(tenantSlug),
    { shouldRetryOnError: false },
  );
  const schoolLegalTexts = legalRead.data;
  const failure: unknown =
    (phaseId
      ? (phasesRead.error ??
        (phaseGone ? PHASE_GONE : undefined) ??
        phaseBootstrapRead.error)
      : templateBootstrapRead.error) ?? legalRead.error;
  const loadError = useSwrLoadError(failure, "die Vorschau", () => {
    if (needsSchoolLegalTexts) void legalRead.mutate();
    if (phaseId) {
      void phasesRead.mutate();
      if (requestedPhase) void phaseBootstrapRead.mutate();
      return;
    }
    void phasesRead.mutate();
    void templateBootstrapRead.mutate();
  });
  // The schema preview also waits for the phase links (failing or not), as
  // one load; the error waits for its catalog text.
  const loading =
    !missingSchema &&
    (failure !== undefined
      ? loadError === null
      : (phaseId
          ? phaseBootstrap === undefined
          : templateBootstrap === undefined ||
            (phases === undefined && phasesRead.error === undefined)) ||
        (needsSchoolLegalTexts && schoolLegalTexts === undefined));

  const previewStatus = previewPhase
    ? phasePreviewStatus(previewPhase, enrollmentEnabled)
    : activeAssignedPhaseCount > 0
      ? {
          label: "Aktiv in Anmeldephase",
          hint: `Diese Vorlage wird in ${phaseCount(activeAssignedPhaseCount, "aktiven ")} verwendet.`,
          tone: "green" as const,
        }
      : assignedPhaseCount > 0
        ? {
            label: "In Phase verwendet",
            hint: `Diese Vorlage ist in ${phaseCount(assignedPhaseCount)} ausgewählt.`,
            tone: "green" as const,
          }
        : {
            label: "Nicht live",
            hint: "Diese Formularvorschau ist nicht an eine aktive Anmeldephase gebunden.",
            tone: "gray" as const,
          };
  const previewTitle = loading
    ? "Formularvorschau"
    : (previewPhase?.name ?? schema?.name ?? "Basisformular");

  return (
    <PublicEnrollmentPageShell withInlineSwitcher>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <PublicEnrollmentBrand tenant={tenant} />
        <div className="flex items-center gap-3">
          <PublicEnrollmentSteps current="form" />
          <PublicEnrollmentLocaleSwitcher />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-5">
          <SectionCard>
            {phaseId ? (
              <BackLink
                href={tenantPath("/enrollment-phases")}
                label="Zurück zu den Anmeldephasen"
              />
            ) : (
              <BackLink
                href={tenantPath("/enrollment-form")}
                label="Zurück zu den Anmeldeformularen"
              />
            )}
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              {previewTitle}
            </h1>
            <div className="mt-4">
              {loading ? (
                <Skeleton shape="round" className="h-6 w-28" />
              ) : (
                <StatusBadge
                  tone={previewStatus.tone}
                  label={previewStatus.label}
                />
              )}
            </div>
            <p className="mt-4 max-w-3xl text-base leading-7 text-gray-600">
              {phaseId
                ? "So sehen Eltern diese Anmeldephase mit ihren Betreuungsangeboten. Hier kannst du nichts absenden."
                : "Hier siehst du nur die Fragen dieses Formulars. Die Betreuungsangebote fehlen hier. Du siehst sie in der Vorschau einer Anmeldephase."}
            </p>
          </SectionCard>

          {loading ? (
            <SkeletonRegion label="Vorschau wird geladen">
              <FormSkeleton />
            </SkeletonRegion>
          ) : loadError || missingSchema || gradeLevelMax === null ? (
            <LoadErrorAlert
              error={
                loadError ??
                (missingSchema
                  ? "Keine Formularvorlage ausgewählt."
                  : "Die Klassenstufen sind für diese Schule nicht eingerichtet.")
              }
            />
          ) : (
            <EnrollmentForm
              gradeLevelMax={gradeLevelMax}
              localizedCopy
              onSubmitted={() => undefined}
              previewMode
              previewSchema={previewSchema}
              previewOfferings={previewOfferings}
              previewLegalTexts={schoolLegalTexts}
              skipCaptcha
            />
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <SectionCard>
            {loading ? (
              <Skeleton className="h-7 w-40" />
            ) : (
              <h2 className="text-xl font-semibold text-gray-900">
                {previewStatus.label}
              </h2>
            )}
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {loading ? "" : `${previewStatus.hint} `}Diese Seite dient nur zur
              Prüfung des Formulars.
            </p>
          </SectionCard>

          {phaseId ? null : (
            <PublicInfoCard
              icon={<Info className="h-5 w-5" />}
              title="Angebote prüfen"
            >
              <PhasePreviewLinks
                loading={loading}
                phases={assignedPhases}
                hrefFor={(phase) =>
                  tenantPath(
                    `/anmeldung/preview?phaseId=${encodeURIComponent(phase.id)}`,
                  )
                }
              />
            </PublicInfoCard>
          )}
          <PublicInfoCard
            icon={<MotoConceptIcon concept={permissionsConcept} size={22} />}
            title="Sichere Vorschau"
          >
            Der Absenden-Button ist in dieser Ansicht deaktiviert.
          </PublicInfoCard>
        </aside>
      </div>
    </PublicEnrollmentPageShell>
  );
}

/** Dative after „in“: „1 aktiven Anmeldephase“, „3 aktiven Anmeldephasen“. */
function phaseCount(count: number, adjective = ""): string {
  return `${count} ${adjective}Anmeldephase${count === 1 ? "" : "n"}`;
}

// Activity and window gates apply to both the public link and parent portal.
function parentViewUnavailableReason(
  phase: Phase,
  now: number,
  enrollmentEnabled: boolean,
): string | null {
  if (!enrollmentEnabled) {
    return "Die Online-Anmeldung ist für diese Schule ausgeschaltet. Schalte unter „Einstellungen“ > „Anmeldung“ die „Online-Anmeldung“ ein.";
  }
  if (!phase.is_active) {
    return "Wähle unter Anmeldephasen bei dieser Phase „Aktivieren“.";
  }
  if (phase.enrollment_open_at && now < Date.parse(phase.enrollment_open_at)) {
    return "Die Elternansicht ist erst ab der Öffnung erreichbar. Prüfe unter Anmeldephasen „Öffnung“ und „Schließung“.";
  }
  if (
    phase.enrollment_close_at &&
    now >= Date.parse(phase.enrollment_close_at)
  ) {
    return "Das Anmeldefenster ist geschlossen. Prüfe unter Anmeldephasen „Öffnung“ und „Schließung“.";
  }
  return null;
}

function phasePreviewStatus(
  phase: Phase,
  enrollmentEnabled: boolean,
): {
  label: string;
  hint: string;
  tone: "green" | "gray";
} {
  const reason = parentViewUnavailableReason(
    phase,
    Date.now(),
    enrollmentEnabled,
  );
  const usesParentPortal =
    phase.audience === "existing_students" ||
    phase.audience === "linked_parents";
  const portalHint =
    "Die Anmeldung läuft über das Elternportal. Dort sehen Eltern nur Phasen für ihre Kinder. Der öffentliche Link öffnet diese Phase nicht.";
  if (reason === null) {
    return {
      label: usesParentPortal
        ? "Über das Elternportal erreichbar"
        : "Eltern erreichen diese Phase",
      hint: usesParentPortal
        ? portalHint
        : "Eltern melden sich über den Link der Phase an.",
      tone: "green",
    };
  }
  return {
    label: "Eltern erreichen diese Phase noch nicht",
    hint: usesParentPortal ? `${reason} ${portalHint}` : reason,
    tone: "gray",
  };
}

function PhasePreviewLinks({
  loading,
  phases,
  hrefFor,
}: Readonly<{
  loading: boolean;
  phases: Phase[] | null;
  hrefFor: (phase: Phase) => string;
}>) {
  if (loading) return null;
  if (phases === null) {
    return (
      <>Öffne unter Anmeldephasen bei der Phase „Vorschau mit Angeboten“.</>
    );
  }
  if (phases.length === 0) {
    return (
      <>
        Diese Vorlage gehört noch zu keiner Anmeldephase. Wähle sie unter
        Anmeldephasen bei „Formular zuweisen“ aus.
      </>
    );
  }
  return (
    <>
      So sehen Eltern das Formular mit deinen Angeboten:
      <ul className="mt-3 space-y-2">
        {phases.map((phase) => (
          <li key={phase.id}>
            <ButtonLink
              href={hrefFor(phase)}
              aria-label={`Vorschau von „${phase.name}“ mit Angeboten öffnen`}
              variant="outline"
              size="md"
              className="w-full min-w-0 justify-between gap-2"
            >
              <span className="truncate">{phase.name}</span>
              <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
            </ButtonLink>
          </li>
        ))}
      </ul>
    </>
  );
}
