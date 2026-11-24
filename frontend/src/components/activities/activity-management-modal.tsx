"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  fetchActivity,
  updateActivity,
  deleteActivity,
  type Activity,
} from "~/lib/activity-api";
import { useReadDraft } from "~/lib/swr/read-draft";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import {
  activityFormProblem,
  parseParticipantLimit,
  useActivityForm,
  type ActivityFormState,
} from "~/hooks/useActivityForm";
import { createLogger } from "~/lib/logger";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { Checkbox } from "~/components/ui/checkbox";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { SpinnerIcon } from "~/components/ui/icons";
import { Trash2 } from "lucide-react";
import { InfoIcon } from "@phosphor-icons/react";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { NumberStepper } from "~/components/ui/number-stepper";
import { ActivityWaitlistSection } from "./activity-waitlist-section";
import { Loading } from "~/components/ui/loading";

const logger = createLogger({ component: "ActivityManagement" });

/** The form of a read activity: what the dialog edits and saves. */
function activityForm(activity: Activity): ActivityFormState {
  return {
    name: activity.name,
    category_id: activity.ag_category_id || "",
    max_participants: activity.max_participant?.toString() ?? "",
  };
}

interface ActivityManagementModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: (message?: string) => void;
  readonly activity: Activity;
  readonly currentStaffId?: string | null;
  readonly readOnly?: boolean;
}

// Helper component for normal footer with save/delete buttons
function NormalFooter({
  readOnly,
  isSubmitting,
  isDeleting,
  loading,
  waitReason,
  onClose,
  onShowDeleteConfirm,
}: Readonly<{
  readOnly: boolean;
  isSubmitting: boolean;
  isDeleting: boolean;
  loading: boolean;
  /** Why saving waits for the stored state (ADR 0311). */
  waitReason?: string;
  onClose: () => void;
  onShowDeleteConfirm: () => void;
}>) {
  return (
    <div className="flex w-full items-center justify-between">
      <div className="flex items-center gap-2">
        {!readOnly && (
          <Button
            type="button"
            variant="ghost_danger"
            size="icon"
            onClick={onShowDeleteConfirm}
            disabled={isSubmitting || isDeleting}
            aria-label="Aktivität löschen"
            tooltip="Löscht die Aktivität mit allen Anmeldungen, moto fragt vorher nach."
          >
            <Trash2 className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onClose}
          disabled={isSubmitting || isDeleting}
          noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
        >
          Abbrechen
        </Button>

        {!readOnly && (
          <Button
            type="submit"
            size="md"
            form="activity-management-form"
            disabled={isSubmitting || loading || isDeleting}
            className="min-w-[100px]"
            tooltip="Speichert die Änderungen an der Aktivität, sie gelten sofort."
            disabledReason={isSubmitting || isDeleting ? undefined : waitReason}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <SpinnerIcon />
                Speichern…
              </span>
            ) : (
              "Speichern"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ActivityManagementModal({
  isOpen,
  onClose,
  onSuccess,
  activity,
  currentStaffId: _currentStaffId,
  readOnly = false,
}: ActivityManagementModalProps) {
  const submission = useFormModalPending(isOpen);
  const isSubmitting = submission.pending;
  // The list row carries no version: the dialog reads the activity once it
  // opens and edits that stored state (ADR 0311). A newer read refills the
  // form only while nobody has typed into it; the save sends its version.
  const edit = useReadDraft<
    Activity,
    ActivityFormState,
    string | undefined,
    Activity
  >({
    key: isOpen && !readOnly ? tenantAdminKeys.activity(activity.id) : null,
    fetcher: () => fetchActivity(activity.id),
    token: (read) => read.version,
    toDraft: activityForm,
    answer: (saved) => saved,
  });
  // Read-only, the dialog shows the list row and saves nothing.
  const form = edit.draft ?? activityForm(activity);
  const setForm = edit.setDraft;
  // Until the first read fills the draft, typing would go nowhere.
  const locked = readOnly || edit.draft === undefined;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // The categories of the form; its own form state stays unused here.
  const { categories, loading, loadError } = useActivityForm(
    activityForm(activity),
    isOpen,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearFormErrors, fieldError } = formErrors;
  const draftForm = useReadDraftForm(
    readOnly ? null : edit,
    formErrors,
    "die Aktivität",
  );
  // Löschfehler bleiben im offenen Löschdialog.
  const deleteErrors = useApiFormError();
  const { clear: clearDeleteErrors } = deleteErrors;
  // „Wiederholen“ läuft mit dem aktuellen Formularstand.
  const retrySaveRef = useRef<() => void>(() => undefined);
  const retryDeleteRef = useRef<() => void>(() => undefined);
  const stepMaxParticipants = (delta: -1 | 1) => {
    setForm((prev) => {
      const current = Number.parseInt(prev.max_participants, 10);
      if (!Number.isFinite(current)) return prev;
      return {
        ...prev,
        max_participants: Math.max(1, current + delta).toString(),
      };
    });
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    clearFormErrors();
  };

  // A new opening starts without the errors of the last one.
  useEffect(() => {
    if (isOpen) {
      clearFormErrors();
      clearDeleteErrors();
      setShowDeleteConfirm(false);
    }
  }, [isOpen, activity, clearFormErrors, clearDeleteErrors]);

  const save = async () => {
    // Nothing goes out until the stored state is read (ADR 0311).
    if (!draftForm.begin()) return;
    const problem = activityFormProblem(form);
    if (problem) {
      formErrors.invalid(problem.message, { [problem.field]: problem.message });
      return;
    }

    await submission.run(async (op) => {
      // Only what the dialog shows: the route keeps the opening, the room,
      // the schedules and the supervisors (ADR 0311).
      const result = await edit.submit((version, draft) =>
        updateActivity(activity.id, {
          name: draft.name.trim(),
          category_id: draft.category_id,
          max_participants: parseParticipantLimit(draft.max_participants),
          expected_version: version,
        }),
      );
      if (result.ok) {
        const successMessage = `Die Aktivität „${result.saved.name}“ ist gespeichert.`;

        // Close modal with animation
        if (op.isCurrent()) onClose();

        // Handle success with message after modal starts closing
        setTimeout(() => {
          if (onSuccess) {
            onSuccess(successMessage);
          }
        }, 100);
        return;
      }
      if (result.skipped) return;
      const err = result.error;
      logger.error("activity_update_failed", {
        error: err instanceof Error ? err.message : String(err),
        activity_id: activity.id,
      });
      if (!op.isCurrent()) return;
      // Changed since it was read: the form shows the stored state once it
      // is read, and the message waits for that read; the same save would
      // be refused again, so it offers no retry.
      void formErrors.show(err, {
        object: "die Aktivität",
        retry: () => retrySaveRef.current(),
        reload: result.reload,
      });
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const handleDelete = async () => {
    deleteErrors.clear();
    // Auch das Löschen sperrt den Dialog, und eine späte Antwort schließt
    // keinen inzwischen neuen Dialog (#6533).
    await submission.run(async (op) => {
      setIsDeleting(true);
      try {
        await deleteActivity(activity.id);

        const successMessage = `Die Aktivität „${activity.name}“ ist gelöscht.`;

        // Close modal with animation
        if (op.isCurrent()) onClose();

        // Handle success with message after modal starts closing
        setTimeout(() => {
          if (onSuccess) {
            onSuccess(successMessage);
          }
        }, 100);
      } catch (err) {
        logger.error("activity_delete_failed", {
          error: err instanceof Error ? err.message : String(err),
          activity_id: activity.id,
        });
        if (!op.isCurrent()) return;
        void deleteErrors.show(err, {
          object: "die Aktivität",
          retry: () => retryDeleteRef.current(),
        });
      } finally {
        setIsDeleting(false);
      }
    });
  };

  useLayoutEffect(() => {
    retrySaveRef.current = () => void save();
    retryDeleteRef.current = () => void handleDelete();
  });

  const footer = (
    <NormalFooter
      readOnly={readOnly}
      isSubmitting={isSubmitting}
      isDeleting={isDeleting}
      loading={loading || (!readOnly && !edit.canSubmit)}
      waitReason={draftForm.waitReason}
      onClose={onClose}
      onShowDeleteConfirm={() => setShowDeleteConfirm(true)}
    />
  );

  return (
    <>
      <FormModal
        isOpen={isOpen}
        onClose={onClose}
        pending={submission}
        title={`Aktivität: ${activity.name}`}
        size="sm"
        mobilePosition="center"
        footer={footer}
      >
        {loading ? (
          <Loading message="Kategorien werden geladen…" />
        ) : (
          <form
            ref={formRef}
            id="activity-management-form"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* Creator info - positioned at top */}
            <div className="-mx-2 -mt-2 mb-4 border-b border-gray-100 px-2 pb-3 md:-mx-2 md:px-2">
              <p className="text-sm text-gray-500">
                Erstellt von:{" "}
                {activity.supervisors &&
                activity.supervisors.length > 0 &&
                activity.supervisors[0]
                  ? (activity.supervisors[0].full_name ?? "Unbekannt")
                  : "Unbekannt"}
              </p>
            </div>

            <LoadErrorAlert error={loadError} />
            <LoadErrorAlert error={draftForm.loadError} />
            <FormErrorAlert message={formErrors.error} />

            {/* Activity Name Card - Compact */}
            <InsetPanel framed>
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block flex items-center gap-1.5 text-xs font-semibold text-gray-700"
                >
                  <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-gray-100">
                    <span className="text-xs font-bold text-gray-700">1</span>
                  </div>
                  Aktivitätsname
                </label>
                <Input
                  id="name"
                  name="name"
                  controlSize="compact"
                  value={form.name}
                  onChange={onInput}
                  aria-invalid={fieldError("name") ? true : undefined}
                  placeholder="z. B. Hausaufgaben, Malen, Basteln…"
                  className="disabled:cursor-not-allowed"
                  required
                  disabled={locked}
                  maxLength={255}
                />
              </div>
            </InsetPanel>

            {/* Category Card - Compact */}
            <InsetPanel framed>
              <div>
                <label
                  id="category_id-label"
                  htmlFor="category_id"
                  className="mb-2 block flex items-center gap-1.5 text-xs font-semibold text-gray-700"
                >
                  <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-gray-100">
                    <span className="text-xs font-bold text-gray-700">2</span>
                  </div>
                  Kategorie
                </label>
                <CustomSelect
                  id="category_id"
                  name="category_id"
                  ariaLabelledBy="category_id-label"
                  value={form.category_id}
                  onChange={(next) => {
                    setForm((prev) => ({ ...prev, category_id: next }));
                    clearFormErrors();
                  }}
                  invalid={Boolean(fieldError("category_id"))}
                  options={[
                    { value: "", label: "Kategorie wählen…" },
                    ...categories.map((category) => ({
                      value: category.id,
                      label: category.name,
                    })),
                  ]}
                  placeholder="Kategorie wählen…"
                  required
                  disabled={locked}
                />
              </div>
            </InsetPanel>

            {/* Participants Card - Compact */}
            <InsetPanel framed>
              <div>
                <label
                  htmlFor="max_participants"
                  className="mb-2 block flex items-center gap-1.5 text-xs font-semibold text-gray-700"
                >
                  <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-gray-100">
                    <span className="text-xs font-bold text-gray-700">3</span>
                  </div>
                  Maximale Teilnehmerzahl
                </label>
                <NumberStepper
                  id="max_participants"
                  name="max_participants"
                  type="number"
                  min="1"
                  value={form.max_participants}
                  onChange={onInput}
                  onStep={stepMaxParticipants}
                  canDecrement={Number.parseInt(form.max_participants, 10) > 1}
                  decrementLabel="Teilnehmer reduzieren"
                  incrementLabel="Teilnehmer erhöhen"
                  aria-invalid={
                    fieldError("max_participants") ? true : undefined
                  }
                  required={Boolean(form.max_participants)}
                  disabled={locked || !form.max_participants}
                />
                <label
                  htmlFor="activity-no-participant-limit"
                  className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-gray-700"
                >
                  <Checkbox
                    id="activity-no-participant-limit"
                    checked={!form.max_participants}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        max_participants: event.target.checked ? "" : "15",
                      }));
                    }}
                    disabled={locked}
                  />
                  Keine Begrenzung
                </label>
              </div>
            </InsetPanel>

            <ActivityWaitlistSection activityId={activity.id} />

            {/* Hinweiskarte. Die Löschabfrage läuft über das
              `ConfirmDeleteModal`, nicht über einen Wechsel dieser Karte
              und des Fußes (Bauart 2, Regel 6). */}
            <InsetPanel framed>
              <div className="flex items-center gap-2">
                <MotoDuotoneIcon
                  icon={InfoIcon}
                  tone="neutral"
                  size={14}
                  className="flex-shrink-0"
                />
                <p className="text-xs text-gray-600">
                  {readOnly
                    ? "Du kannst nur Aktivitäten bearbeiten, die du selbst erstellt hast."
                    : "Änderungen werden sofort wirksam."}
                </p>
              </div>
            </InsetPanel>
          </form>
        )}
      </FormModal>

      {/* Portalweit dasselbe Löschmuster. Für eine Aktivität reicht die
          zweistufige Rückfrage; die Texteingabe bleibt Fällen mit
          Datenverlust vorbehalten. */}
      <ConfirmDeleteModal
        isOpen={!readOnly && showDeleteConfirm}
        title="Aktivität löschen"
        description={`Möchtest du die Aktivität „${activity.name}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`}
        gate={{ mode: "twoStep" }}
        confirmTooltip="Löscht die Aktivität mit allen Anmeldungen sofort und endgültig."
        onConfirm={handleDelete}
        onClose={() => {
          clearDeleteErrors();
          setShowDeleteConfirm(false);
        }}
        loading={isDeleting}
        error={deleteErrors.error}
      />
    </>
  );
}
