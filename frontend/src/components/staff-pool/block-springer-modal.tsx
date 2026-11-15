"use client";

// Einen Springer aus dem Vertretungspool für die eigene Schule blocken
// (#4709). Tag und Zeit, mehr nicht: Grund und Gruppe speichert moto nicht,
// andere Schulen sehen nur, dass die Schule die Person geblockt hat. Ist die
// Zeit schon geblockt, auch gerade eben von einer anderen Schule, kommt die
// Meldung aus dem Fehlerkatalog.

import { useEffect, useRef, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { blockSpringer, inPool, type PoolSpringer } from "~/lib/staff-pool-api";

const logger = createLogger({ component: "BlockSpringerModal" });

/** Was der Dialog öffnet: ein Springer an einem freien Tag. */
export interface BlockSpringerTarget {
  readonly springer: PoolSpringer;
  readonly date: string;
}

interface Draft {
  date: string;
  startTime: string;
  endTime: string;
}

const TIME = /^\d{2}:\d{2}$/;

function draftErrors(
  draft: Draft,
  springer: PoolSpringer,
  today: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.date || draft.date < today) {
    errors.date = "Bitte wählen Sie einen Tag ab heute.";
  } else if (!inPool(springer, draft.date)) {
    errors.date = "An diesem Tag ist die Person nicht im Vertretungspool.";
  }
  if (!TIME.test(draft.startTime))
    errors.start_time = "Bitte geben Sie den Beginn an.";
  if (!TIME.test(draft.endTime)) {
    errors.end_time = "Bitte geben Sie das Ende an.";
  } else if (TIME.test(draft.startTime) && draft.endTime <= draft.startTime) {
    errors.end_time = "Das Ende muss nach dem Beginn liegen.";
  }
  return errors;
}

export function BlockSpringerModal({
  target,
  todayIso,
  onClose,
  onBlocked,
}: Readonly<{
  target: BlockSpringerTarget | null;
  todayIso: string;
  onClose: () => void;
  /** Nach dem Blocken, mit dem Satz für die Erfolgsmeldung. */
  onBlocked: (message: string) => void;
}>) {
  const isOpen = target !== null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { clear: clearErrors } = errors;

  useEffect(() => {
    if (!target) return;
    setDraft({ date: target.date, startTime: "08:00", endTime: "13:00" });
    clearErrors();
  }, [target, clearErrors]);

  if (!target || !draft) return null;
  const { springer } = target;
  const name = `${springer.firstName} ${springer.lastName}`;
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const submit = async () => {
    const invalid = draftErrors(draft, springer, todayIso);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfen Sie die markierten Felder.", invalid);
      return;
    }
    await save.run(async (op) => {
      try {
        await blockSpringer({ recordId: springer.recordId, ...draft });
        if (!op.isCurrent()) return;
        onBlocked(
          `${name} ist am ${formatDate(draft.date)} von ${draft.startTime} bis ${draft.endTime} Uhr für Ihre Schule geblockt.`,
        );
      } catch (err) {
        logger.error("staff_pool_block_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        await errors.show(err, { object: "die Blockung" });
      }
    });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title="Springer blocken"
      titleLevel={2}
      error={errors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          saveLabel="Blocken"
          saveTooltip="Hält die Person zu dieser Zeit für Ihre Schule frei."
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm font-medium text-gray-900">{name}</p>
        <ISODatePicker
          label="Tag"
          value={draft.date}
          min={todayIso}
          max={springer.poolUntil ?? undefined}
          onChange={(date) => set({ date })}
          error={errors.fieldError("date")}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Beginn"
            type="time"
            required
            name="start_time"
            controlSize="compact"
            className="tabular-nums"
            value={draft.startTime}
            onChange={(event) => set({ startTime: event.target.value })}
            error={errors.fieldError("start_time")}
          />
          <Input
            label="Ende"
            type="time"
            required
            name="end_time"
            controlSize="compact"
            className="tabular-nums"
            value={draft.endTime}
            onChange={(event) => set({ endTime: event.target.value })}
            error={errors.fieldError("end_time")}
          />
        </div>
        <Alert
          type="info"
          size="compact"
          message="Andere Schulen sehen nur, dass Ihre Schule geblockt hat. In Ihren Dienstplan trägt die Personalverwaltung die Person ein."
        />
      </form>
    </FormModal>
  );
}
