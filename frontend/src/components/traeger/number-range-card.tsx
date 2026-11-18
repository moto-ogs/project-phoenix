"use client";

// Rechnungsnummern der Ferienbetreuung (#4668) und der Monatsbeiträge
// (#4684): das Muster, aus dem die Freigabe eines Laufs die Nummern
// vergibt, lückenlos und in Reihenfolge. Jede Leistung hat ihren eigenen
// Nummernkreis. Die nächste Nummer lässt sich nach oben setzen, damit ein
// Träger die Nummern seines bisherigen Programms fortführt (#7358); jede
// Änderung steht im Verlauf.

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { byLabel, exportedAtLabel } from "./finance-export-format";
import { NumberRangeStartModal } from "./number-range-start-modal";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  type NumberRange,
  saveCareNumberRange,
  saveCareNumberRangeStart,
  saveHolidayNumberRange,
  saveHolidayNumberRangeStart,
} from "~/lib/traeger-billing-api";

const logger = createLogger({ component: "NumberRangeCard" });

/** What differs between the number range of the holidays and of the months. */
const SERVICES = {
  holiday: {
    title: "Rechnungsnummern der Ferien",
    description:
      "Bei der Freigabe bekommt jede Rechnung die nächste Nummer. Es entsteht keine Lücke.",
    defaultPattern: "FE-{JJJJ}-{NNNN}",
    save: saveHolidayNumberRange,
    saveStart: saveHolidayNumberRangeStart,
  },
  care: {
    title: "Rechnungsnummern der Monatsbeiträge",
    description:
      "Eigener Nummernkreis für die Monatsbeiträge. Nimm ein anderes Kürzel als bei den Ferien.",
    defaultPattern: "MB-{JJJJ}-{NNNN}",
    save: saveCareNumberRange,
    saveStart: saveCareNumberRangeStart,
  },
} as const;

export function NumberRangeCard({
  numberRange,
  onChanged,
  service = "holiday",
}: Readonly<{
  numberRange: NumberRange;
  onChanged: () => Promise<unknown>;
  service?: keyof typeof SERVICES;
}>) {
  const copy = SERVICES[service];
  const [open, setOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [pattern, setPattern] = useState("");
  const save = useFormModalPending(open);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();
  // The reload after a saved pattern is a load error above the card, never
  // an error of the closed dialog (#6652).
  const afterSave = useRefreshAfterWrite(
    "die Anzeige des Nummernkreises",
    onChanged,
  );

  useEffect(() => {
    if (!open) return;
    setPattern(numberRange.pattern || copy.defaultPattern);
    clearErrors();
  }, [open, numberRange.pattern, copy.defaultPattern, clearErrors]);

  const submit = async () => {
    formErrors.clear();
    if (!pattern.trim()) {
      formErrors.invalid("Bitte prüfe deine Angaben.", {
        pattern: "Bitte gib ein Muster an.",
      });
      return;
    }
    await save.run(async (op) => {
      try {
        await copy.save(pattern.trim());
      } catch (err) {
        logger.error("number_range_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "das Muster" });
        return;
      }
      success("Das Muster ist gespeichert.");
      if (op.isCurrent()) setOpen(false);
      await afterSave.refresh();
    });
  };

  const set = Boolean(numberRange.pattern);
  const { starts, lastNumber, year } = numberRange;
  // A pattern with a year starts again each year; the label names the year.
  const nextLabel = `${lastNumber > 0 ? "Nächste Nummer" : "Erste Nummer"}${year > 0 ? ` ${year}` : ""}`;
  return (
    <SectionCard
      title={copy.title}
      description={copy.description}
      actions={
        <div className="flex flex-wrap gap-2">
          {set ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              tooltip="Öffnet ein Fenster für die Nummer der nächsten Rechnung."
              onClick={() => setStartOpen(true)}
            >
              Nächste Nummer ändern
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="md"
            tooltip="Öffnet ein Fenster für das Muster der Rechnungsnummern."
            onClick={() => setOpen(true)}
          >
            {set ? "Muster ändern" : "Muster festlegen"}
          </Button>
        </div>
      }
    >
      <LoadErrorAlert error={afterSave.error} className="mb-4" />
      {set ? (
        <>
          <DataGrid columns={4}>
            <DataField label="Muster">
              <span className="font-mono">{numberRange.pattern}</span>
            </DataField>
            <DataField label={nextLabel}>
              <span className="font-mono">{numberRange.example}</span>
            </DataField>
            <DataField label="Letzte laufende Nummer">
              {lastNumber > 0 ? (
                <span className="font-mono">{lastNumber}</span>
              ) : (
                <span className="font-normal text-gray-600">
                  Noch keine Rechnung
                </span>
              )}
            </DataField>
          </DataGrid>
          {starts.length > 0 ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="link"
                size="compact"
                aria-expanded={history}
                tooltip={
                  history
                    ? "Blendet die Änderungen der nächsten Nummer wieder aus."
                    : "Zeigt, wer die nächste Nummer wann geändert hat."
                }
                onClick={() => setHistory((shown) => !shown)}
              >
                {history
                  ? "Verlauf ausblenden"
                  : `Verlauf ansehen (${starts.length})`}
              </Button>
              {history ? (
                <InsetPanel padding="sm" className="mt-2 min-w-0">
                  <ol
                    className="divide-y divide-gray-100"
                    aria-label={`Verlauf der nächsten Nummer: ${copy.title}`}
                  >
                    {starts.map((start) => (
                      <li
                        key={`${start.setAt}-${start.nextNumber}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm"
                      >
                        <span className="text-gray-600 tabular-nums">
                          {exportedAtLabel(start.setAt)}
                        </span>
                        <span className="text-gray-900">
                          Nächste Nummer:{" "}
                          <span className="font-mono break-all">
                            {start.example}
                          </span>
                        </span>
                        <span className="text-gray-600">
                          {byLabel(
                            start.setByYou,
                            start.setByAccount,
                            start.setByName,
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </InsetPanel>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-gray-700">
          Noch kein Muster. Ohne Muster kannst du keinen Lauf freigeben.
        </p>
      )}
      <FormModal
        isOpen={open}
        onClose={() => setOpen(false)}
        pending={save}
        isBackdropDismissDisabled
        title={set ? "Muster ändern" : "Muster festlegen"}
        size="md"
        error={formErrors.error}
        footer={
          <EditActions
            onCancel={() => setOpen(false)}
            onSave={() => formRef.current?.requestSubmit()}
            saving={saving}
          />
        }
      >
        <form
          ref={formRef}
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            controlSize="touch"
            id={`number-range-pattern-${service}`}
            name="pattern"
            label="Muster der Rechnungsnummer"
            value={pattern}
            maxLength={40}
            error={formErrors.fieldError("pattern") ?? undefined}
            onChange={(event) => setPattern(event.target.value)}
          />
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
            <li>
              <span className="font-mono">{"{NNNN}"}</span> ist die laufende
              Nummer, hier mit 4 Stellen. Erlaubt sind 1 bis 8 N.
            </li>
            <li>
              <span className="font-mono">{"{JJJJ}"}</span> oder{" "}
              <span className="font-mono">{"{JJ}"}</span> ist das Jahr. Mit Jahr
              beginnt die Nummer jedes Jahr wieder bei 1.
            </li>
            <li>
              Sonst sind Buchstaben, Ziffern und die Zeichen . / _ - erlaubt.
            </li>
          </ul>
          <p className="text-sm text-gray-600">
            Ausgestellte Rechnungen behalten ihre Nummer.
          </p>
        </form>
      </FormModal>
      <NumberRangeStartModal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        numberRange={numberRange}
        save={copy.saveStart}
        onSaved={afterSave.refresh}
      />
    </SectionCard>
  );
}
