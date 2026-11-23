"use client";

// Anspruch einer eigenen Abwesenheitsart für eine Person (#2874, #3256).
// Bearbeitet wird an Ort und Stelle der Kontingent-Karte (BAUARTEN-SPEC
// Bauart 2): Tage mit Minus und Plus oder direkt eintippen, Begründung für das
// Änderungsprotokoll, unten `EditActions`.

import { useLayoutEffect, useRef, useState } from "react";

import { FieldLabel } from "~/components/ui/field-label";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { NumberStepper } from "~/components/ui/number-stepper";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDayCount } from "~/lib/absence-helpers";
import {
  absenceTypeService,
  type AbsenceType,
  type AbsenceTypeAllowanceSummary,
} from "~/lib/absence-type-api";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";

const logger = createLogger({ component: "CustomAllowanceEditor" });

const MAX_DAYS = 366;

function parseDays(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  if (raw.trim() === "" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_DAYS || !Number.isInteger(value * 2)) {
    return null;
  }
  return value;
}

function formatInput(days: number): string {
  return String(days).replace(".", ",");
}

/** Was das Formular bearbeitet: die Tage als getippter Text, die Begründung. */
interface AllowanceDraft {
  readonly days: string;
  readonly reason: string;
}

const allowanceDraft = (
  summary: AbsenceTypeAllowanceSummary,
): AllowanceDraft => ({ days: formatInput(summary.entitledDays), reason: "" });

export function CustomAllowanceEditForm({
  staffId,
  year,
  type,
  summary,
  read,
  onCancel,
  onSaved,
}: {
  readonly staffId: string;
  readonly year: number;
  readonly type: AbsenceType;
  readonly summary: AbsenceTypeAllowanceSummary;
  /**
   * The tab's read of this claim: reads it again (rejects on failure,
   * ADR 0311 rule 6) and takes the stored claim a save answered.
   */
  readonly read: {
    readonly reload: () => Promise<AbsenceTypeAllowanceSummary | undefined>;
    readonly write: (stored: AbsenceTypeAllowanceSummary) => Promise<unknown>;
  };
  readonly onCancel: () => void;
  /** Closes the form and reloads; never rejects (#6652). */
  readonly onSaved: RefreshAfterWrite;
}) {
  // Der Anspruch beim Öffnen (ADR 0311): seine Version geht mit dem
  // Speichern. Eine neuere Lesung füllt das Formular nur nach, solange nichts
  // getippt ist; nach einer Ablehnung steht der gespeicherte Anspruch da, und
  // nichts geht raus, bevor er gelesen ist.
  const edit = useDraftOn<
    AbsenceTypeAllowanceSummary,
    AllowanceDraft,
    string,
    AbsenceTypeAllowanceSummary
  >(
    {
      opening: `${staffId}:${type.id}:${year}`,
      data: summary,
      reload: read.reload,
      write: read.write,
    },
    {
      token: (claim) => claim.version,
      toDraft: allowanceDraft,
      // Die Begründung erklärt die Änderung, sie ist kein gespeicherter
      // Wert: sie bleibt über dem gespeicherten Anspruch stehen.
      rebase: (draft, _from, stored) => ({
        ...allowanceDraft(stored),
        reason: draft.reason,
      }),
      answer: (saved) => saved,
    },
  );
  const { days, reason } = edit.draft ?? allowanceDraft(summary);
  const set = (patch: Partial<AllowanceDraft>) =>
    edit.setDraft((current) => ({ ...current, ...patch }));
  const [saving, setSaving] = useState(false);
  const formErrors = useApiFormError();
  const form = useReadDraftForm(edit, formErrors, "den Anspruch");
  const toast = useToast();
  // „Wiederholen“ sendet den aktuellen Entwurf, nicht den vom Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);

  const shown = edit.base ?? summary;
  const used = shown.takenDays + shown.reservedDays;
  const parsed = parseDays(days);

  const step = (delta: number) => {
    const next = Math.min(MAX_DAYS, Math.max(used, (parsed ?? 0) + delta));
    set({ days: formatInput(next) });
  };

  const save = async () => {
    // Enter sendet auch: nichts geht raus, bevor der gespeicherte Anspruch
    // gelesen ist; ein gezeigter Fehler bleibt dann stehen.
    if (!form.begin()) return;
    const daysError =
      parsed === null
        ? "Bitte ganze oder halbe Tage zwischen 0 und 366 eintragen."
        : parsed < used
          ? `Mindestens ${formatDayCount(used)}. So viele sind schon eingetragen oder beantragt.`
          : undefined;
    const reasonError =
      reason.trim() === ""
        ? "Bitte kurz sagen, warum sich der Anspruch ändert."
        : undefined;
    if (daysError || reasonError || parsed === null) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", {
        ...(daysError ? { entitled_days: daysError } : {}),
        ...(reasonError ? { reason: reasonError } : {}),
      });
      return;
    }
    setSaving(true);
    const result = await edit.submit((version, sent) =>
      absenceTypeService.setAllowance(type.id, staffId, {
        year,
        entitledDays: parsed,
        reason: sent.reason.trim(),
        expectedVersion: version,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("custom_allowance_save_failed", {
        staff_id: staffId,
        absence_type_id: type.id,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Seit dem Lesen geändert: das Formular bleibt offen, `reload` zeigt
      // den gespeicherten Anspruch, ohne „Wiederholen“ mit derselben Version.
      await formErrors.show(
        result.error,
        result.refused
          ? { object: "die Änderung am Anspruch", reload: result.reload }
          : {
              object: "die Änderung am Anspruch",
              retry: () => void latestSaveRef.current(),
            },
      );
      return;
    }
    toast.success(`Der Anspruch ${type.name} ist gespeichert.`);
    await onSaved();
  };

  useLayoutEffect(() => {
    latestSaveRef.current = save;
  });

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={`Anspruch ${type.name} ${year}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormErrorAlert message={formErrors.error} />
      <LoadErrorAlert error={form.loadError} />
      <div>
        <FieldLabel htmlFor={`allowance-days-${type.id}`}>
          Anspruch {year} in Tagen
        </FieldLabel>
        <NumberStepper
          id={`allowance-days-${type.id}`}
          name="entitled_days"
          inputMode="decimal"
          value={days}
          onChange={(event) => set({ days: event.target.value })}
          onStep={step}
          canDecrement={(parsed ?? 0) - 1 >= used}
          canIncrement={(parsed ?? 0) + 1 <= MAX_DAYS}
          decrementLabel="Einen Tag weniger"
          incrementLabel="Einen Tag mehr"
          error={formErrors.fieldError("entitled_days")}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-gray-500">
          Halbe Tage mit Komma, z. B. 1,5. Beim Start mit moto: die Tage
          eintragen, die noch übrig sind.
        </p>
      </div>
      <Input
        id={`allowance-reason-${type.id}`}
        name="reason"
        label="Begründung"
        value={reason}
        onChange={(event) => set({ reason: event.target.value })}
        placeholder="z. B. in den Sommerferien krank"
        error={formErrors.fieldError("reason")}
        disabled={saving}
      />
      <EditActions onCancel={onCancel} saving={saving} />
    </form>
  );
}
