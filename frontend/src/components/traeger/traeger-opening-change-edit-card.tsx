"use client";

/**
 * TraegerOpeningChangeEditCard changes a saved opening change of the Träger
 * in place (#8202), like the school's own (#8173). The save carries the
 * version the day was read at (ADR 0311); a day changed since then is
 * refused, and the card shows the stored day again.
 */

import { useRef, useState } from "react";

import {
  TraegerOpeningChangeFields,
  type TraegerOpeningChangeForm,
  traegerOpeningChangeFieldErrors,
  traegerOpeningChangeForm,
  traegerOpeningChangeInput,
} from "~/components/traeger/traeger-opening-change-form";
import type { TraegerSchoolOption } from "~/components/traeger/traeger-school-choice";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type TraegerOpeningChange,
  updateTraegerOpeningChange,
} from "~/lib/traeger-opening-changes";

const logger = createLogger({ component: "TraegerOpeningChangeEditCard" });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TraegerOpeningChangeEditCard({
  change,
  reload,
  onStored,
  onClose,
  schools,
  minDate,
  maxDate,
}: Readonly<{
  change: TraegerOpeningChange;
  /** Reads the day again; rejects when the read fails or the day is gone. */
  reload: () => Promise<TraegerOpeningChange>;
  /** Puts a saved day into the list. */
  onStored: (stored: TraegerOpeningChange) => Promise<unknown>;
  onClose: () => void;
  schools: readonly TraegerSchoolOption[];
  minDate: string;
  maxDate: string;
}>) {
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const errors = useApiFormError(formRef);
  const { success: toastSuccess } = useToast();
  const edit = useDraftOn<
    TraegerOpeningChange,
    TraegerOpeningChangeForm,
    string,
    TraegerOpeningChange
  >(
    {
      opening: `traeger-opening-change:${change.id}`,
      data: change,
      reload,
      write: onStored,
    },
    {
      token: (read) => read.version,
      toDraft: traegerOpeningChangeForm,
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(edit, errors, "die geänderte Öffnungszeit");
  const draft = edit.draft;

  const save = async () => {
    if (!draft || !form.begin()) return;
    const invalid = traegerOpeningChangeFieldErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    try {
      const result = await edit.submit((version, sent) =>
        updateTraegerOpeningChange(
          change.id,
          traegerOpeningChangeInput(sent),
          version,
        ),
      );
      if (result.ok) {
        toastSuccess(`„${result.saved.reason}“ ist gespeichert.`);
        onClose();
        return;
      }
      if (result.skipped) return;
      logger.error("traeger_opening_change_update_failed", {
        opening_change_id: change.id,
        persisted: result.persisted,
        error: message(result.error),
      });
      if (result.persisted) {
        void errors.show(result.error, {
          object: "die Liste der geänderten Öffnungszeiten",
          messageSuffix: "Die Änderung ist gespeichert. Lade die Liste neu.",
          action: {
            label: "Liste neu laden",
            onClick: () => {
              errors.clear();
              edit.retryLoad();
            },
          },
        });
        return;
      }
      // Changed since editing began: the card stays open on the stored day
      // and says so, without a retry (ADR 0311).
      void errors.show(result.error, {
        object: "das Speichern der geänderten Öffnungszeit",
        reload: result.reload,
      });
    } catch (error) {
      logger.error("traeger_opening_change_update_failed", {
        opening_change_id: change.id,
        error: message(error),
      });
      void errors.show(error, {
        object: "das Speichern der geänderten Öffnungszeit",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={change.reason}
      description="Du änderst diesen Tag. Die neuen Zeiten gelten sofort an den gewählten Schulen."
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!edit.canSubmit}
          disabledReason={form.waitReason}
          saveTooltip="Speichert die neuen Zeiten. Die Schulen sehen sie sofort."
        />
      }
    >
      <div ref={formRef} className="space-y-4">
        <LoadErrorAlert error={form.loadError} />
        <FormErrorAlert message={errors.error} />
        {draft ? (
          <TraegerOpeningChangeFields
            idPrefix={`traeger-opening-change-${change.id}`}
            form={draft}
            onChange={edit.setDraft}
            fieldError={errors.fieldError}
            schools={schools}
            minDate={minDate}
            maxDate={maxDate}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
