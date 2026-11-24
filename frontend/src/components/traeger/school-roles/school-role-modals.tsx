"use client";

// Die zwei Dialoge der Träger-Rollen (#4810): eine Rolle anlegen und eine
// Rolle entfernen. Vor dem Entfernen zeigt moto je Schule, wer die Rolle
// hat; ohne diese Vorschau lässt sich nichts entfernen.

import { useEffect, useRef, useState } from "react";

import {
  EMPTY_SCHOOL_ROLE,
  SchoolRoleFields,
  schoolRoleDraftErrors,
  type SchoolRoleMasterDraft,
} from "~/components/traeger/school-roles/school-role-fields";
import { holderCountLabel } from "~/components/traeger/school-roles/school-role-card";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EditActions } from "~/components/ui/edit-actions";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { FramedList } from "~/components/ui/framed-list";
import { Loading } from "~/components/ui/loading";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { isChangedSinceRead } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  createTraegerSchoolRole,
  fetchTraegerSchoolRoleRemoval,
  removeTraegerSchoolRole,
  type TraegerSchoolRole,
  type TraegerSchoolRoleCatalog,
  type TraegerSchoolRoleRemoval,
  type TraegerSchoolRoleRemovalSchool,
} from "~/lib/traeger-school-roles-api";

const logger = createLogger({ component: "TraegerSchoolRoleModals" });

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export function CreateSchoolRoleModal({
  isOpen,
  catalog,
  onClose,
  onCreated,
}: Readonly<{
  isOpen: boolean;
  catalog: TraegerSchoolRoleCatalog;
  onClose: () => void;
  onCreated: (role: TraegerSchoolRole) => void;
}>) {
  const [draft, setDraft] = useState<SchoolRoleMasterDraft>(EMPTY_SCHOOL_ROLE);
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { clear: clearErrors } = errors;

  useEffect(() => {
    if (!isOpen) return;
    setDraft(EMPTY_SCHOOL_ROLE);
    clearErrors();
  }, [isOpen, clearErrors]);

  const submit = async () => {
    const invalid = schoolRoleDraftErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    await save.run(async (op) => {
      try {
        const created = await createTraegerSchoolRole({
          ...draft,
          permissionIds: catalog.templates[draft.baseRole],
        });
        if (op.isCurrent()) onCreated(created);
      } catch (err) {
        logger.error("traeger_school_role_create_failed", {
          error: errorMessage(err),
        });
        if (op.isCurrent()) void errors.show(err, { object: "die Rolle" });
      }
    });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title="Rolle anlegen"
      titleLevel={2}
      error={errors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          saveLabel="Anlegen"
          saveTooltip="Legt die Rolle an und trägt sie sofort in alle deine Schulen."
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <SchoolRoleFields
          idPrefix="traeger-school-role-new"
          draft={draft}
          onChange={setDraft}
          fieldError={errors.fieldError}
          creating
        />
        <p className="mt-4 text-sm text-gray-600">
          Die Rechte passt du danach in der Karte der Rolle an.
        </p>
      </form>
    </FormModal>
  );
}

function holderName(holder: { name: string; email: string }): string {
  return holder.name || holder.email;
}

function RemovalSchool({
  school,
}: Readonly<{ school: TraegerSchoolRoleRemovalSchool }>) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
          {school.schoolName}
        </span>
        <span className="shrink-0 text-sm text-gray-600">
          {holderCountLabel(school.holders.length)}
        </span>
      </div>
      <p className="mt-1 text-sm wrap-anywhere text-gray-700">
        {school.holders.map(holderName).join(", ")}
      </p>
      {school.keptForInvitations ? (
        <p className="mt-1 text-sm text-gray-600">
          Hier bleibt die Rolle als eigene Rolle der Schule, weil eine Einladung
          sie nennt. Niemand verliert sie.
        </p>
      ) : null}
    </li>
  );
}

/** Wer die Rolle verliert, je Schule. Schulen ohne Personen stehen nicht da. */
function RemovalPreview({
  removal,
}: Readonly<{ removal: TraegerSchoolRoleRemoval }>) {
  const affected = removal.schools.filter(
    (school) => school.holders.length > 0 || school.keptForInvitations,
  );
  const losing = removal.schools
    .filter((school) => !school.keptForInvitations)
    .reduce((sum, school) => sum + school.holders.length, 0);
  if (affected.length === 0) {
    return (
      <p className="text-sm text-gray-700">
        Noch niemand hat diese Rolle. Sie verschwindet aus allen Schulen.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {losing > 0 ? (
        <Alert
          type="warning"
          message={
            losing === 1
              ? "1 Person verliert diese Rolle und wird abgemeldet. Ihre Schule gibt ihr danach eine andere Rolle."
              : `${losing} Personen verlieren diese Rolle und werden abgemeldet. Ihre Schule gibt ihnen danach eine andere Rolle.`
          }
        />
      ) : null}
      <FramedList maxHeight="md">
        {affected.map((school) => (
          <RemovalSchool key={school.schoolId} school={school} />
        ))}
      </FramedList>
    </div>
  );
}

export function RemoveSchoolRoleModal({
  role,
  onClose,
  onRemoved,
}: Readonly<{
  /** Die Rolle, die entfernt werden soll; `null` schließt den Dialog. */
  role: TraegerSchoolRole | null;
  onClose: () => void;
  onRemoved: (role: TraegerSchoolRole) => void;
}>) {
  // Die Vorschau nennt Personen: Sie wird bei jedem Öffnen frisch gelesen
  // und nie aus dem Speicher gezeigt.
  const preview = useFreshTraegerResource(
    role ? traegerKeys.schoolRoleRemoval(role.id) : null,
    () => fetchTraegerSchoolRoleRemoval(role?.id ?? ""),
    "die Personen mit dieser Rolle",
  );
  const [removing, setRemoving] = useState(false);
  const errors = useApiFormError();
  const { clear: clearErrors } = errors;
  const roleId = role?.id;

  useEffect(() => {
    clearErrors();
  }, [roleId, clearErrors]);

  const confirm = async () => {
    if (!role || !preview.data) return;
    setRemoving(true);
    try {
      await removeTraegerSchoolRole(role.id, preview.data.version);
      onRemoved(role);
    } catch (err) {
      logger.error("traeger_school_role_remove_failed", {
        error: errorMessage(err),
      });
      // Eine Schule hat die Rolle inzwischen vergeben oder genommen: Die
      // Vorschau wird neu gelesen, entfernt ist nichts.
      const changed = isChangedSinceRead(err);
      void errors.show(
        err,
        changed
          ? {
              object: "das Entfernen der Rolle",
              reload: preview.reloadOrThrow,
            }
          : { object: "das Entfernen der Rolle" },
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ConfirmDeleteModal
      isOpen={role !== null}
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Rolle entfernen?"
      description={
        <>
          <span className="font-medium wrap-anywhere">{role?.name}</span>{" "}
          verschwindet aus allen deinen Schulen. Das lässt sich nicht rückgängig
          machen.
        </>
      }
      warningSlot={
        preview.data ? (
          <RemovalPreview removal={preview.data} />
        ) : preview.error ? (
          <LoadErrorAlert error={preview.error} />
        ) : (
          <Loading message="Personen mit dieser Rolle werden geladen…" />
        )
      }
      gate={{ mode: "twoStep", firstStepLabel: "Rolle entfernen" }}
      confirmDisabled={!preview.data}
      loading={removing}
      error={errors.error}
      confirmLabel="Endgültig entfernen"
      confirmTooltip="Entfernt die Rolle sofort aus allen Schulen und meldet ihre Personen ab."
      loadingLabel="Wird entfernt…"
    />
  );
}
