"use client";

// Module importierter Verträge neu zuordnen (#7764): Hat der Träger seine
// Module nach dem Import neu geordnet, buchen die importierten Verträge noch
// die alten. Eine CSV-Datei nennt je Vertrag, Wochentag und bisherigem Modul
// das neue Modul. moto zeigt je Vertrag, was sich ändert; nach der
// Bestätigung bekommt jeder bereite Vertrag eine neue Version ab „Gilt ab“.
// Eltern bekommen keine Nachricht, eine Abrechnung startet nicht.

import { CheckCircle, Download } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  OFFERING_CORRECTION_COLUMNS,
  OFFERING_CORRECTION_SAMPLE,
  contractCount,
  firstOfNextMonth,
  missingColumnsText,
} from "~/components/traeger/care-contract-offering-correction-format";
import { CareContractOfferingCorrectionPreviewCard } from "~/components/traeger/care-contract-offering-correction-preview-card";
import { importFormatLabel } from "~/components/traeger/sepa-import-format";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { ISODatePicker } from "~/components/ui/date-picker";
import { Dropzone } from "~/components/ui/dropzone";
import { EmptyState } from "~/components/ui/empty-state";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { berlinTodayISO, formatDate } from "~/lib/date-helpers";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  MAX_OFFERING_CORRECTION_FILE_BYTES,
  applyOfferingCorrection,
  previewOfferingCorrection,
  type OfferingCorrectionResult,
} from "~/lib/traeger-offering-correction-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerOfferingCorrectionPage" });

const STEPS = ["Datei wählen", "Prüfen", "Ändern"];

const INFO =
  "Hier ordnest du die Buchungen importierter Verträge anderen Modulen zu, zum Beispiel nach einer neuen Ordnung deiner Module. Jeder geänderte Vertrag bekommt eine neue Version. Wochentage und Endzeiten bleiben. Eltern bekommen keine Nachricht. Die Datei bewahrt moto nicht auf.";

const VERTRAEGE = "/traeger/vertraege";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function doneDescription(done: OfferingCorrectionResult): string {
  const { counts } = done;
  const left = [
    counts.unchanged > 0 ? `${counts.unchanged} schon zugeordnet` : null,
    counts.held > 0 ? `${counts.held} zurückgestellt` : null,
    counts.invalid > 0 ? `${counts.invalid} nicht möglich` : null,
  ].filter(Boolean);
  const rest = left.length > 0 ? ` Unverändert: ${left.join(", ")}.` : "";
  return `Die neuen Versionen gelten ab ${formatDate(done.effectiveFrom)}${laterStartText(done)}. Du findest sie beim Vertrag unter „Versionen“.${rest}`;
}

// A contract that begins after the chosen day changes from its own first
// day: both summaries say so, as the preview does per contract.
function laterStartText(result: OfferingCorrectionResult): string {
  const later = result.contracts.some(
    (contract) =>
      (contract.status === "ready" || contract.status === "corrected") &&
      contract.hints.includes("start_moved"),
  );
  return later ? ", bei späterem Vertragsbeginn ab dem ersten Vertragstag" : "";
}

export default function TraegerOfferingCorrectionPage() {
  const invalidateFamily = useInvalidateFamily();
  // A day the office keeps across files; the first of next month is when a
  // contract is usually billed anew.
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    firstOfNextMonth(berlinTodayISO()),
  );
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OfferingCorrectionResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<OfferingCorrectionResult | null>(null);
  const { show, showMessage } = useApiErrorDisplay();
  const { success } = useToast();
  // Only the answer to the newest look at the file counts.
  const request = useRef(0);

  const read = useCallback(
    async (chosen: File, day: string) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await previewOfferingCorrection({
          file: chosen,
          effectiveFrom: day,
        });
        if (id === request.current) {
          setResult(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error("offering_correction_preview_failed", {
          error: errorText(err),
        });
        if (id === request.current) void show(err, { object: "die Datei" });
      } finally {
        if (id === request.current) setReading(false);
      }
    },
    [show],
  );

  const choose = (chosen: File) => {
    if (!/\.(csv|txt)$/i.test(chosen.name)) {
      showMessage(
        "Bitte wähle eine CSV-Datei. Eine Excel-Datei speichere vorher als CSV.",
      );
      return;
    }
    if (chosen.size > MAX_OFFERING_CORRECTION_FILE_BYTES) {
      showMessage("Die Datei ist zu groß. Erlaubt sind 2 MB.");
      return;
    }
    setFile(chosen);
    setResult(null);
    setDone(null);
    void read(chosen, effectiveFrom);
  };

  const changeDay = (day: string) => {
    if (day === "" || day === effectiveFrom) return;
    setEffectiveFrom(day);
    // Every contract is checked against the day: a new day, a new preview.
    if (file && !applying) void read(file, day);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyOfferingCorrection({
        file,
        effectiveFrom: result.effectiveFrom,
        fingerprint: result.fingerprint,
      });
      setConfirming(false);
      setDone(applied);
      success(`${contractCount(applied.counts.corrected)} geändert.`);
    } catch (err) {
      setConfirming(false);
      logger.error("offering_correction_apply_failed", {
        error: errorText(err),
      });
      void show(err, { object: "die Verträge" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.import_changed")
      ) {
        // A contract changed since the office looked: show the current
        // preview, the correction waits for a new confirmation.
        void read(file, result.effectiveFrom);
      }
      return;
    } finally {
      setApplying(false);
    }
    // The contracts have new versions: their lists and pages read again.
    void invalidateFamily(traegerContractKeys.listFamily);
  };

  const restart = () => {
    request.current++;
    setFile(null);
    setResult(null);
    setVerified(false);
    setDone(null);
    setReading(false);
  };

  const missing = result?.missingColumns ?? [];
  const step = !result || missing.length > 0 ? 0 : verified ? 2 : 1;
  const today = berlinTodayISO();
  const ready = result?.counts.ready ?? 0;

  return (
    <TenantPage
      title="Module neu zuordnen"
      info={INFO}
      back
      backHref={traegerPath(VERTRAEGE)}
      backLabel="Zurück zu den Verträgen"
    >
      {done ? (
        <SectionCard>
          <EmptyState
            tone="success"
            icon={<CheckCircle aria-hidden className="size-6" />}
            title={`${contractCount(done.counts.corrected)} geändert`}
            description={doneDescription(done)}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <ButtonLink
                  href={traegerPath(VERTRAEGE)}
                  variant="primary"
                  size="md"
                  tooltip="Öffnet die Liste aller Verträge."
                >
                  Zu den Verträgen
                </ButtonLink>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={restart}
                  tooltip="Startet mit einer anderen Datei von vorn."
                >
                  Weitere Datei
                </Button>
              </div>
            }
          />
        </SectionCard>
      ) : (
        <>
          <SectionCard>
            <WizardStepper steps={STEPS} current={step} />
          </SectionCard>
          <SectionCard
            title={file ? "Datei" : "Datei wählen"}
            description={
              file ? (
                // A long file name without spaces breaks anywhere instead
                // of running past the card on a phone.
                <span className="wrap-anywhere">
                  {result
                    ? `${file.name} · ${importFormatLabel(result.encoding, result.delimiter)}`
                    : file.name}
                </span>
              ) : (
                "Eine CSV-Datei mit einer Zeile pro Vertrag, Wochentag und bisherigem Modul."
              )
            }
            action={
              file ? (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={restart}
                  disabled={applying}
                  tooltip="Verwirft die gelesene Datei, ohne etwas zu ändern."
                >
                  Andere Datei
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  tooltip="Speichert eine Beispieldatei mit allen Spalten, die moto erkennt."
                  onClick={() =>
                    downloadBlob(
                      new Blob(["﻿", OFFERING_CORRECTION_SAMPLE], {
                        type: "text/csv;charset=utf-8",
                      }),
                      "module-zuordnen-beispiel.csv",
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Beispieldatei
                </Button>
              )
            }
          >
            <div className="flex flex-col gap-6">
              {file ? null : (
                <Dropzone
                  accept=".csv,.txt,text/csv,text/plain"
                  legend="CSV-Datei mit den neuen Modulen"
                  label="CSV-Datei hierher ziehen"
                  dragLabel="Datei hier loslassen"
                  buttonLabel="Datei wählen"
                  hint="Bis 2 MB. Spalten: Vertrag, Wochentag, Bisheriges_Modul, Neues_Modul. Ein leeres neues Modul heißt: noch nicht entschieden."
                  loading={reading}
                  loadingLabel="Datei wird gelesen …"
                  onFile={choose}
                />
              )}
              <div className="sm:max-w-xs">
                <ISODatePicker
                  id="offering-correction-effective-from"
                  label="Gilt ab"
                  hint="Ab diesem Tag buchen die Verträge die neuen Module. Frühestens heute."
                  value={effectiveFrom}
                  onChange={changeDay}
                  min={today}
                  required
                  hideClearButton
                  disabled={applying}
                />
              </div>
            </div>
          </SectionCard>
          {file && !verified ? (
            <Alert
              type="info"
              message={
                reading
                  ? "Die Datei wird geprüft …"
                  : "Die Datei ist noch nicht geprüft. Bitte prüfe erneut."
              }
              action={
                !reading ? (
                  <Button
                    type="button"
                    variant="ghost_tone"
                    size="compact"
                    tooltip="Liest die Datei noch einmal und prüft jeden Vertrag."
                    onClick={() => void read(file, effectiveFrom)}
                  >
                    Erneut prüfen
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {result && missing.length > 0 ? (
            <Alert
              type="warning"
              title="In der Datei fehlen Spalten"
              message={`Es fehlt: ${missingColumnsText(missing)}. Ergänze die Spalten und wähle die Datei danach noch einmal.`}
              details={
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {missing.map((field) => (
                    <li key={field}>
                      {`${OFFERING_CORRECTION_COLUMNS[field].label}: Überschrift „${OFFERING_CORRECTION_COLUMNS[field].header}“`}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {result && missing.length === 0 ? (
            <CareContractOfferingCorrectionPreviewCard
              result={result}
              applying={applying}
              disabled={!verified}
              onApply={() => setConfirming(true)}
            />
          ) : null}
          {result ? (
            <ConfirmationModal
              isOpen={confirming}
              title={`${contractCount(ready)} ändern?`}
              confirmText={`${contractCount(ready)} ändern`}
              confirmVariant="success"
              confirmTooltip="Gibt den Verträgen sofort eine neue Version."
              isConfirmLoading={applying}
              loadingText="Wird geändert …"
              onClose={() => setConfirming(false)}
              onConfirm={() => void apply()}
            >
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-700">
                <li>
                  {`${contractCount(ready)} ${ready === 1 ? "bekommt" : "bekommen"} ab ${formatDate(result.effectiveFrom)}${laterStartText(result)} eine neue Version mit den neuen Modulen.`}
                </li>
                <li>Wochentage und Endzeiten bleiben gleich.</li>
                <li>Frühere Versionen bleiben beim Vertrag lesbar.</li>
                <li>Eltern bekommen keine Nachricht.</li>
                {result.counts.held + result.counts.invalid > 0 ? (
                  <li>
                    Zurückgestellte Verträge und Verträge mit „Nicht möglich“
                    bleiben, wie sie sind.
                  </li>
                ) : null}
              </ul>
            </ConfirmationModal>
          ) : null}
        </>
      )}
    </TenantPage>
  );
}
