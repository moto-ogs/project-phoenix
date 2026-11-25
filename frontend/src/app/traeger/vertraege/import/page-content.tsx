"use client";

// Import von Kindern und ihren bestehenden Betreuungsverträgen (#4723), zum
// Beispiel aus OGS Connect: Datei wählen, Spalten zuordnen, jede Zeile prüfen
// und die bereiten übernehmen. moto liest die Datei nur und bewahrt sie nicht
// auf. Eine Datei lässt sich nach Korrekturen wieder laden: Kinder, die ihren
// Vertrag schon haben, zeigt moto als „Schon vorhanden“.

import { CheckCircle, Download } from "lucide-react";
import { useSession } from "next-auth/react";
import { useState } from "react";
import {
  CONTRACT_IMPORT_SAMPLE,
  contractCountLabel,
  contractsWithoutEmail,
  rowsWithoutConditions,
} from "~/components/traeger/care-contract-import-format";
import { CareContractImportLogCard } from "~/components/traeger/care-contract-import-log-card";
import { CareContractImportMappingCard } from "~/components/traeger/care-contract-import-mapping-card";
import { CareContractImportPreviewCard } from "~/components/traeger/care-contract-import-preview-card";
import { importFormatLabel } from "~/components/traeger/sepa-import-format";
import { useCsvFilePreview } from "~/components/traeger/use-csv-file-preview";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { Dropzone } from "~/components/ui/dropzone";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { hasPermission } from "~/lib/auth-utils";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  MAX_CONTRACT_IMPORT_FILE_BYTES,
  applyContractImport,
  fetchContractImportLog,
  previewContractImport,
  type ContractImportMapping,
  type ContractImportResult,
} from "~/lib/traeger-care-contract-import-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerContractImportPage" });

const STEPS = ["Datei wählen", "Spalten zuordnen", "Prüfen und übernehmen"];

const INFO =
  "Hier übernimmst du Kinder und Verträge, die du schon in einem anderen Programm hast. Jeder Vertrag gilt sofort als abgeschlossen, Eltern bekommen keine Mail. Die Datei bewahrt moto nicht auf.";

const VERTRAEGE = "/traeger/vertraege";
const BEDINGUNGEN = "/traeger/vertraege/bedingungen";
const NACHPFLEGE = "/traeger/vertraege/nachpflege";
const VERKNUEPFEN = "/traeger/vertraege/verknuepfen";
const GESCHWISTER = "/traeger/vertraege/geschwister";

const readContractImport = (
  file: File,
  mapping: ContractImportMapping | null,
): Promise<ContractImportResult> => previewContractImport({ file, mapping });

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function doneDescription(done: ContractImportResult): string {
  const { counts } = done;
  const parts = [
    `${counts.duplicate} schon vorhanden`,
    `${counts.conflict + counts.invalid} nicht übernommen`,
  ];
  if (counts.debtorNumbers > 0) {
    parts.push(
      counts.debtorNumbers === 1
        ? "1 Debitorennummer eingetragen"
        : `${counts.debtorNumbers} Debitorennummern eingetragen`,
    );
  }
  if (counts.familyChildren > 0) {
    parts.push(
      counts.familyChildren === 1
        ? "1 Kinderzahl bestätigt"
        : `${counts.familyChildren} Kinderzahlen bestätigt`,
    );
  }
  const withoutEmail = contractsWithoutEmail(done);
  const paper =
    withoutEmail > 0
      ? ` ${contractCountLabel(withoutEmail)} ohne Mail-Adresse: Diesen Familien gibst du die Rechnungen auf Papier. Geschwister unter ihnen führst du unter „Geschwister zusammenführen“ zusammen.`
      : "";
  return `${parts.join(", ")}.${paper} Du findest die Verträge unter Verträge mit dem Stand „Aktiv“. Als Nächstes verknüpfst du sie mit der Kinderakte des Kindes.`;
}

export default function TraegerContractImportPage() {
  const { data: session } = useSession();
  const canManage = hasPermission(session ?? null, "traeger_contracts:manage");
  const {
    data: log,
    error: logError,
    mutate: mutateLog,
  } = useTraegerResource(
    canManage ? traegerContractKeys.importLog() : null,
    fetchContractImportLog,
    "die Liste der Importe",
  );
  const invalidateFamily = useInvalidateFamily();
  const {
    file,
    result,
    setResult,
    verified,
    reading,
    read,
    choose: chooseFile,
    restart: restartFile,
  } = useCsvFilePreview<ContractImportMapping, ContractImportResult>({
    preview: readContractImport,
    logEvent: "contract_import_preview_failed",
    maxBytes: MAX_CONTRACT_IMPORT_FILE_BYTES,
  });
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ContractImportResult | null>(null);
  const { show } = useApiErrorDisplay();
  const { success } = useToast();

  const choose = (chosen: File) => {
    if (chooseFile(chosen)) setDone(null);
  };

  const remap = (mapping: ContractImportMapping) => {
    if (!file || !result || applying) return;
    setResult({ ...result, mapping });
    void read(file, mapping);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyContractImport({
        file,
        mapping: result.mapping,
        fingerprint: result.fingerprint,
      });
      setDone(applied);
      success(`${contractCountLabel(applied.counts.imported)} übernommen.`);
    } catch (err) {
      logger.error("contract_import_apply_failed", { error: errorText(err) });
      void show(err, { object: "die Verträge" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.import_changed")
      ) {
        // The rows changed since the office looked: show the current ones,
        // the import waits for a new confirmation.
        void read(file, result.mapping);
      }
      return;
    } finally {
      setApplying(false);
    }
    // The imported contracts are active at once, and their children no
    // longer wait for a contract.
    void invalidateFamily(traegerContractKeys.listFamily);
    void invalidateFamily(traegerContractKeys.candidates());
    await mutateLog();
  };

  const restart = () => {
    restartFile();
    setDone(null);
  };

  const step = !result ? 0 : result.unmapped.length > 0 ? 1 : 2;
  const withoutConditions = result ? rowsWithoutConditions(result) : 0;

  return (
    <TenantPage
      title="Verträge importieren"
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
            title={`${contractCountLabel(done.counts.imported)} übernommen`}
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
                <ButtonLink
                  href={traegerPath(VERKNUEPFEN)}
                  variant="outline"
                  size="md"
                  tooltip="Öffnet das Verknüpfen der Verträge mit der Kinderakte."
                >
                  Mit Kinderakten verknüpfen
                </ButtonLink>
                {contractsWithoutEmail(done) > 0 ? (
                  <ButtonLink
                    href={traegerPath(GESCHWISTER)}
                    variant="outline"
                    size="md"
                    tooltip="Öffnet die Familien ohne Mail-Adresse, um Geschwister zusammenzuführen."
                  >
                    Geschwister zusammenführen
                  </ButtonLink>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={restart}
                  disabled={applying}
                  tooltip="Startet einen neuen Import mit einer anderen Datei."
                >
                  Weitere Datei laden
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
          {file ? (
            <SectionCard
              title="Datei"
              description={
                // A long file name without spaces breaks anywhere instead
                // of running past the card on a phone.
                <span className="wrap-anywhere">
                  {result
                    ? `${file.name} · ${importFormatLabel(result.encoding, result.delimiter)} · ${result.headers.length} Spalten`
                    : file.name}
                </span>
              }
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={restart}
                  disabled={applying}
                  tooltip="Verwirft die gelesene Datei, ohne etwas zu übernehmen."
                >
                  Andere Datei
                </Button>
              }
            />
          ) : (
            <SectionCard
              title="Datei wählen"
              description="Eine CSV-Datei mit einer Zeile pro Kind und Überschriften in der ersten Zeile."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  tooltip="Speichert eine Beispieldatei mit allen Spalten, die moto von selbst erkennt."
                  onClick={() =>
                    downloadBlob(
                      new Blob(["﻿", CONTRACT_IMPORT_SAMPLE], {
                        type: "text/csv;charset=utf-8",
                      }),
                      "vertraege-beispiel.csv",
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Beispieldatei
                </Button>
              }
            >
              <Dropzone
                accept=".csv,.txt,text/csv,text/plain"
                legend="CSV-Datei mit Kindern und Verträgen"
                label="CSV-Datei hierher ziehen"
                dragLabel="Datei hier loslassen"
                buttonLabel="Datei wählen"
                hint="Bis 2 MB. Getrennt mit Semikolon oder Komma, aus Excel, OGS Connect oder einem anderen Programm."
                loading={reading}
                loadingLabel="Datei wird gelesen …"
                onFile={choose}
              />
            </SectionCard>
          )}
          {result ? (
            <CareContractImportMappingCard
              headers={result.headers}
              mapping={result.mapping}
              unmapped={result.unmapped}
              schools={result.schools}
              debtorNumberScope={result.debtorNumberScope}
              familyChildrenAllowed={result.familyChildrenAllowed}
              disabled={applying}
              onChange={remap}
            />
          ) : null}
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
                    tooltip="Liest die Datei noch einmal und prüft jede Zeile."
                    onClick={() => void read(file, result?.mapping ?? null)}
                  >
                    Erneut prüfen
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {withoutConditions > 0 ? (
            <Alert
              type="warning"
              title="Zuerst die Vertragsbedingungen eintragen"
              message={`${withoutConditions === 1 ? "1 Zeile nennt" : `${withoutConditions} Zeilen nennen`} ein Modul ohne Vertragsbedingungen. Trage Laufzeit und Kündigungsfrist ein und prüfe die Datei danach erneut.`}
              action={
                <ButtonLink
                  href={traegerPath(BEDINGUNGEN)}
                  variant="surface"
                  size="compact"
                  tooltip="Öffnet die Vertragsbedingungen der Module."
                >
                  Zu den Vertragsbedingungen
                </ButtonLink>
              }
            />
          ) : null}
          {result && result.unmapped.length === 0 ? (
            <CareContractImportPreviewCard
              result={result}
              applying={applying}
              disabled={!verified}
              onApply={() => void apply()}
            />
          ) : null}
          {result && result.unmapped.length > 0 ? (
            <Alert
              type="info"
              message="Ordne alle Pflichtfelder zu. Dann zeigt moto die Zeilen."
            />
          ) : null}
        </>
      )}
      {logError ? (
        <LoadErrorAlert error={logError} />
      ) : log ? (
        <CareContractImportLogCard
          entries={log}
          // Imported contracts know only what the file had; the originals
          // complete them (#7767).
          action={
            log.length > 0 ? (
              <ButtonLink
                href={traegerPath(NACHPFLEGE)}
                variant="outline"
                size="md"
                tooltip="Öffnet die Seite, um Parteien, Abschlussart und Abschlussdatum zu ergänzen."
              >
                Vertragsangaben nachpflegen
              </ButtonLink>
            ) : undefined
          }
        />
      ) : null}
    </TenantPage>
  );
}
