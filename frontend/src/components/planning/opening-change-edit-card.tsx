"use client";

/**
 * OpeningChangeEditCard changes a saved day with other opening hours in
 * place (#8173): the list switches to this card, not to an overlay
 * (`bauart/no-edit-overlay`). The save carries the version the day was read
 * at (ADR 0311); a day changed since then is refused, and the card shows the
 * stored day again.
 */

import { useRef, useState } from "react";

import {
  OpeningChangeFields,
  type OpeningChangeForm,
  openingChangeFieldErrors,
  openingChangeForm,
} from "~/components/planning/opening-change-fields";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  type OpeningChange,
  openingChangeService,
} from "~/lib/opening-change-api";
import { useDraftOn } from "~/lib/swr/read-draft";

const logger = createLogger({ component: "OpeningChangeEditCard" });

export function OpeningChangeEditCard({
  change,
  reload,
  onStored,
  onClose,
  minDate,
  maxDate,
}: Readonly<{
  change: OpeningChange;
  /** Reads the day again; rejects when the read fails or the day is gone. */
  reload: () => Promise<OpeningChange>;
  /** Puts a saved day into the list. */
  onStored: (stored: OpeningChange) => Promise<unknown>;
  onClose: () => void;
  minDate: string;
  maxDate: string;
}>) {
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const errors = useApiFormError(formRef);
  const { success: toastSuccess } = useToast();
  const edit = useDraftOn<
    OpeningChange,
    OpeningChangeForm,
    string,
    OpeningChange
  >(
    {
      opening: `opening-change:${change.id}`,
      data: change,
      reload,
      write: onStored,
    },
    {
      token: (read) => read.version,
      toDraft: openingChangeForm,
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(edit, errors, "die geänderte Öffnungszeit");
  const draft = edit.draft;

  const save = async () => {
    if (!draft || !form.begin()) return;
    const invalid = openingChangeFieldErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    const result = await edit.submit((version, sent) =>
      openingChangeService.update(
        change.id,
        { ...sent, reason: sent.reason.trim() },
        version,
      ),
    );
    setSaving(false);
    if (result.ok) {
      toastSuccess(`„${result.saved.reason}“ ist gespeichert.`);
      onClose();
      return;
    }
    if (result.skipped) return;
    logger.error("opening_change_update_failed", {
      opening_change_id: change.id,
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    // Changed since editing began: the card stays open on the stored day
    // and says so, without a retry (ADR 0311).
    void errors.show(result.error, {
      object: "das Speichern der geänderten Öffnungszeit",
      reload: result.reload,
    });
  };

  return (
    <SectionCard
      title={change.reason}
      description="Du änderst diesen Tag. Die neuen Zeiten gelten sofort."
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!edit.canSubmit}
          disabledReason={form.waitReason}
          saveTooltip="Speichert die neuen Zeiten. Eltern sehen sie in „Heute anders“."
        />
      }
    >
      <div ref={formRef} className="space-y-4">
        <LoadErrorAlert error={form.loadError} />
        <FormErrorAlert message={errors.error} />
        {draft ? (
          <OpeningChangeFields
            idPrefix={`opening-change-${change.id}`}
            form={draft}
            onChange={edit.setDraft}
            fieldError={errors.fieldError}
            minDate={minDate}
            maxDate={maxDate}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
