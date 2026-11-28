"use client";

// Preview + apply step for a Jahrgangswechsel draft: shows exactly what will
// happen (per-class counts, Abgänge, unmapped classes) and requires an
// explicit second confirmation before applying.

import { Alert } from "~/components/ui/alert";
import { FramedList } from "~/components/ui/framed-list";
import { SectionLabel } from "~/components/ui/section-label";
import { useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "~/lib/api-error";
import { StatCard } from "~/components/ui/stat-card";
import { Button } from "~/components/ui/button";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { ListSkeleton, SkeletonRegion } from "~/components/ui/page-skeletons";
import { ConfirmationModal } from "~/components/ui/modal";
import {
  SlideOver,
  SlideOverContent,
  SlideOverFooter,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { createLogger } from "~/lib/logger";
import {
  applyGradeTransition,
  PREVIEW_STALE_CODE,
  previewGradeTransition,
  type GradeTransition,
  type ParentTargetPreview,
  type TransitionResult,
} from "~/lib/grade-transition-api";

const logger = createLogger({ component: "GradeTransitionPreviewModal" });

interface TransitionPreviewModalProps {
  readonly transition: GradeTransition;
  /** May the current user apply the transition? Gates the apply button and the
   * confirm step so a user without grade_transitions:apply never hits a 403. */
  readonly canApply: boolean;
  /** May the current user edit the draft? Controls whether the footer offers
   * "Zurück zum Entwurf" (edit) or a plain "Schließen". */
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onBackToEditor: () => void;
  readonly onApplied: (result: TransitionResult) => void;
}

export function TransitionPreviewModal({
  transition,
  canApply,
  canEdit,
  onClose,
  onBackToEditor,
  onApplied,
}: TransitionPreviewModalProps) {
  // The preview comes from the shared cache and is read again on opening.
  // The apply carries its fingerprint, and the backend refuses a cohort that
  // changed since (ADR 0311, #405), so a cached preview never applies to
  // other children than it shows.
  const {
    data: cachedData,
    error: previewError,
    mutate,
  } = useSWRAuth(tenantAdminKeys.gradeTransitionPreview(transition.id), () =>
    previewGradeTransition(transition.id),
  );
  // A failed load shows its error, not the preview it was meant to replace.
  const data = previewError ? undefined : cachedData;
  const preview = data ?? null;
  // Ladefehler und Anwendefehler bleiben im Panel, mit Katalogtext und
  // Wiederholen (#2517).
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error: previewError }],
    "die Vorschau",
    () => mutate(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Mounted only while a preview is shown. The session spans the hidden
  // panel while the confirmation applies (#6593), so the panel stays locked
  // when it comes back with an error, and "Wiederholen" in the panel locks it
  // too.
  const save = useFormModalPending(true, transition.id);
  const applying = save.pending;
  const {
    error: applyError,
    show: showApplyError,
    clear: clearApplyError,
  } = useApiFormError();
  const latestApplyRef = useRef<() => void>(() => undefined);

  // Reloads the preview after the backend refused a stale confirmation, so the
  // admin decides again on what is true NOW instead of on the numbers that were
  // rendered before someone else changed the classes or mappings (#405).
  const reloadPreview = () => mutate();

  const handleApply = async () => {
    if (!preview) return;
    await save.run(async (op) => {
      clearApplyError();
      try {
        // Bind the apply to exactly the cohort this modal displayed: the backend
        // refuses it if the affected children or mappings changed in between,
        // rather than silently graduating a different set (#405).
        const result = await applyGradeTransition(
          transition.id,
          preview.fingerprint,
        );
        // Closes the preview; a late answer must not close a later dialog.
        if (op.isCurrent()) onApplied(result);
      } catch (error) {
        logger.error("apply_failed", {
          transition_id: transition.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        // Den Text liefert der Katalog (grade_transition.*). Eine veraltete
        // Vorschau wird neu geladen, damit über den aktuellen Stand entschieden
        // wird (#405).
        void showApplyError(error, {
          object: "das Anwenden des Schuljahreswechsels",
          retry: () => latestApplyRef.current(),
        });
        if (error instanceof ApiError && error.code === PREVIEW_STALE_CODE) {
          await reloadPreview();
        }
        if (op.isCurrent()) setConfirmOpen(false);
      }
    });
  };

  // Wiederholen wendet mit der Vorschau an, die dann gilt.
  useLayoutEffect(() => {
    latestApplyRef.current = () => void handleApply();
  });

  return (
    <>
      <SlideOver
        // Ausgeblendet, solange die Bestätigung offen ist — nie zwei
        // eigenständige Dialoge übereinander (#2774).
        open={!confirmOpen}
        pending={save}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SlideOverContent size="lg">
          <SlideOverHeader>
            <SlideOverTitle>{`Vorschau: Schuljahreswechsel ${transition.academicYear}`}</SlideOverTitle>
          </SlideOverHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!preview && !loadError && (
              <SkeletonRegion label="Vorschau wird geladen">
                <ListSkeleton rows={4} avatar={false} />
              </SkeletonRegion>
            )}
            <LoadErrorAlert error={loadError} />

            {preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    label="Kinder gesamt"
                    value={preview.totalStudents}
                    tone="neutral"
                  />
                  <StatCard
                    label="werden versetzt"
                    value={preview.toPromote}
                    tone="green"
                  />
                  <StatCard
                    label="Abgänge"
                    value={preview.toGraduate}
                    tone="red"
                  />
                </div>

                <FramedList>
                  {preview.byMapping.map((m) => (
                    <li
                      key={m.fromClass}
                      className="flex items-center justify-between p-3 text-sm"
                    >
                      <span className="font-medium text-gray-900">
                        {m.fromClass}
                        {" -> "}
                        {m.toClass ?? "Abgang"}
                      </span>
                      <span className="text-gray-500">
                        {m.studentCount}{" "}
                        {m.studentCount === 1 ? "Kind" : "Kinder"}
                      </span>
                    </li>
                  ))}
                </FramedList>

                <ParentTargetsPreview targets={preview.parentTargets} />

                {preview.toGraduate > 0 && (
                  <Alert
                    type="warning"
                    announce="off"
                    title={`${preview.toGraduate} ${
                      preview.toGraduate === 1
                        ? "Kind verlässt die OGS"
                        : "Kinder verlassen die OGS"
                    }`}
                    message="Diese Kinder werden nach dem Anwenden in der App nicht mehr angezeigt. Über Zurücksetzen lässt sich das wiederherstellen."
                  />
                )}

                {preview.unmappedClasses.length > 0 && (
                  <Alert
                    type="warning"
                    announce="off"
                    title="Nicht berücksichtigte Klassen"
                    message={`${preview.unmappedClasses
                      .map((u) => `${u.className} (${u.studentCount})`)
                      .join(", ")} bleiben unverändert.`}
                  />
                )}

                <FormErrorAlert message={applyError} />
              </div>
            )}
          </div>
          <SlideOverFooter>
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onBackToEditor}
                tooltip="Öffnet den Entwurf wieder zum Ändern."
              >
                Zurück zum Entwurf
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onClose}
                noTooltip="Schließt die Vorschau, sie ändert nichts."
              >
                Schließen
              </Button>
            )}
            {canApply && (
              <Button
                type="button"
                size="md"
                onClick={() => setConfirmOpen(true)}
                disabled={!preview || applying}
                tooltip="Versetzt die Kinder und blendet die Abgänge aus. moto fragt vorher nach."
              >
                Schuljahreswechsel anwenden
              </Button>
            )}
          </SlideOverFooter>
        </SlideOverContent>
      </SlideOver>

      <ConfirmationModal
        isOpen={confirmOpen && canApply}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleApply}
        title="Wirklich anwenden?"
        confirmText="Ja, anwenden"
        confirmTooltip="Versetzt die Kinder sofort und blendet die Abgänge aus."
        cancelText="Abbrechen"
        isConfirmLoading={applying}
        loadingText="Wird angewendet …"
        isDismissDisabled={applying}
      >
        <p>
          Der Schuljahreswechsel {transition.academicYear} wird jetzt für alle
          betroffenen Kinder durchgeführt.
          {preview && preview.toGraduate > 0 && (
            <>
              {" "}
              {preview.toGraduate}{" "}
              {preview.toGraduate === 1 ? "Kind wird" : "Kinder werden"} dabei
              als Abgang aus der App ausgeblendet.
            </>
          )}
        </p>
      </ConfirmationModal>
    </>
  );
}

// Was der Wechsel mit den Klassen-Nachrichten an Eltern und den Entwürfen von
// Mitteilungen macht (#8214): sie gehen mit den Kindern in die neue Klasse,
// bei einer abgehenden Klasse wird die Nachricht geschlossen.
function ParentTargetsPreview({
  targets,
}: {
  readonly targets: readonly ParentTargetPreview[];
}) {
  if (targets.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="transition-parent-targets">
      <SectionLabel as="h3" id="transition-parent-targets">
        Nachrichten an Eltern
      </SectionLabel>
      <p className="text-sm text-gray-600">
        Sie gehen mit den Kindern in die neue Klasse. Schon gesendete
        Nachrichten behalten ihre Empfänger.
      </p>
      <FramedList>
        {targets.map((target) => (
          <li
            key={`${target.kind}-${target.id}-${target.fromClass}`}
            className="flex items-center justify-between gap-3 p-3 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-gray-900">
                {target.title}
              </span>
              <span className="block text-gray-500">
                {target.kind === "group_thread"
                  ? "Gruppennachricht"
                  : "Entwurf einer Mitteilung"}
              </span>
            </span>
            <span className="shrink-0 text-right text-gray-700">
              {parentTargetOutcome(target)}
            </span>
          </li>
        ))}
      </FramedList>
    </section>
  );
}

function parentTargetOutcome(target: ParentTargetPreview): string {
  if (target.toClass) return `${target.fromClass} -> ${target.toClass}`;
  return target.kind === "group_thread"
    ? `${target.fromClass}: wird geschlossen`
    : `${target.fromClass}: Klasse wird entfernt`;
}
