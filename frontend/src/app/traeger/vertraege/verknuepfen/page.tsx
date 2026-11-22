"use client";

// Importierte Verträge mit der Kinderakte verknüpfen (#7760, ADR 0307):
// Datei wählen, die zwei Spalten zuordnen, jede Zeile prüfen und die bereiten
// verknüpfen. Es entscheiden die Nummern von Vertrag und Kinderakte; Name und
// Geburtsdatum vergleicht moto nur. Die Datei bewahrt moto nicht auf. Dieselbe
// Datei lässt sich wieder laden: Verknüpftes zeigt moto als „Schon
// verknüpft“.

import { CheckCircle, Download } from "lucide-react";
import { useState } from "react";
import {
  CHILD_LINK_SAMPLE,
  childLinkContractCount,
} from "~/components/traeger/care-contract-child-link-format";
import { CareContractChildLinkMappingCard } from "~/components/traeger/care-contract-child-link-mapping-card";
import { CareContractChildLinkPreviewCard } from "~/components/traeger/care-contract-child-link-preview-card";
import { importFormatLabel } from "~/components/traeger/sepa-import-format";
import { useCsvFilePreview } from "~/components/traeger/use-csv-file-preview";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { Dropzone } from "~/components/ui/dropzone";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  applyChildLinks,
  previewChildLinks,
  type ChildLinkColumns,
  type ChildLinkResult,
} from "~/lib/traeger-contract-child-links-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerContractChildLinkPage" });

const STEPS = ["Datei wählen", "Spalten zuordnen", "Prüfen und verknüpfen"];

const INFO =
  "Hier verknüpfst du importierte Verträge mit der Kinderakte des Kindes an seiner Schule. Erst dann weiß moto, welches Kind der Vertrag meint. Das braucht der Soll-Ist-Vergleich, die genaue Zuordnung des Essens und das Elternpostfach für Rechnungen. Eltern bekommen keine Nachricht.";

const VERTRAEGE = "/traeger/vertraege";

const readChildLinks = (
  file: File,
  columns: ChildLinkColumns | null,
): Promise<ChildLinkResult> => previewChildLinks({ file, columns });

function doneDescription(done: ChildLinkResult): string {
  const { counts } = done;
  const open = counts.conflict + counts.invalid;
  const parts = [
    `${counts.linked} ${counts.linked === 1 ? "Vertrag war" : "Verträge waren"} schon verknüpft`,
    `${open} ${open === 1 ? "Zeile ist" : "Zeilen sind"} offen`,
  ];
  const next =
    open > 0
      ? " Die offenen Zeilen stehen unten mit dem Grund. Korrigiere die Datei und lade sie noch einmal, oder verknüpfe die Verträge einzeln auf ihrer Seite."
      : "";
  return `${parts.join(", ")}.${next}`;
}

export default function TraegerContractChildLinkPage() {
  const { file, result, setResult, verified, reading, read, choose, restart } =
    useCsvFilePreview<ChildLinkColumns, ChildLinkResult>({
      preview: readChildLinks,
      logEvent: "contract_child_link_preview_failed",
    });
  const invalidateFamily = useInvalidateFamily();
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ChildLinkResult | null>(null);
  const { show } = useApiErrorDisplay();
  const { success } = useToast();

  const chooseFile = (chosen: File) => {
    if (choose(chosen)) setDone(null);
  };

  const remap = (columns: ChildLinkColumns) => {
    if (!file || !result || applying) return;
    setResult({ ...result, columns });
    void read(file, columns);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyChildLinks({
        file,
        columns: result.columns,
        fingerprint: result.fingerprint,
      });
      setDone(applied);
      success(`${childLinkContractCount(applied.counts.stored)} verknüpft.`);
    } catch (err) {
      logger.error("contract_child_link_apply_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void show(err, { object: "die Verträge" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.child_link_changed")
      ) {
        // Contracts or child records changed since the office looked: show
        // the current rows, the run waits for a new confirmation.
        void read(file, result.columns);
      }
      return;
    } finally {
      setApplying(false);
    }
    // The list and every open contract show the new link.
    void invalidateFamily(traegerContractKeys.listFamily);
    void invalidateFamily(traegerContractKeys.detailFamily);
  };

  const startOver = () => {
    restart();
    setDone(null);
  };

  const step = !result ? 0 : result.unmapped.length > 0 ? 1 : 2;
  // A read file, the run and a restart replace the control the person used:
  // the heading of the card that now asks for something takes the focus
  // (#7111). Mapping the last column turns step 1 into step 2 under the
  // person's hand; that moves nothing (WCAG 3.2.2).
  const phase = done ? "done" : result ? "result" : "file";
  const stepFocus = useStepFocus<HTMLDivElement>(phase);
  const focusOn = (target: number | "done") =>
    (done ? target === "done" : target === step) ? stepFocus : undefined;

  return (
    <TenantPage
      title="Verträge mit Kinderakten verknüpfen"
      info={INFO}
      back
      backHref={traegerPath(VERTRAEGE)}
      backLabel="Zurück zu den Verträgen"
    >
      {done ? (
        <>
          <div ref={focusOn("done")}>
            <SectionCard>
              <EmptyState
                tone="success"
                // A heading, so the focus after the run lands on the result.
                titleAs="h2"
                icon={<CheckCircle aria-hidden className="size-6" />}
                title={`${childLinkContractCount(done.counts.stored)} verknüpft`}
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
                      onClick={startOver}
                      tooltip="Startet mit einer anderen Datei von vorn."
                    >
                      Weitere Datei laden
                    </Button>
                  </div>
                }
              />
            </SectionCard>
          </div>
          <CareContractChildLinkPreviewCard
            result={done}
            fileName={file?.name ?? "datei.csv"}
          />
        </>
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
                  onClick={startOver}
                  disabled={applying}
                  tooltip="Verwirft die gelesene Datei, ohne etwas zu verknüpfen."
                >
                  Andere Datei
                </Button>
              }
            />
          ) : (
            <div ref={focusOn(0)}>
              <SectionCard
                title="Datei wählen"
                description="Eine CSV-Datei mit einer Zeile je Vertrag und zwei Spalten: Vertragsnummer und Nummer der Kinderakte."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    tooltip="Speichert eine Beispieldatei mit den zwei Spalten, die moto erkennt."
                    onClick={() =>
                      downloadBlob(
                        new Blob(["﻿", CHILD_LINK_SAMPLE], {
                          type: "text/csv;charset=utf-8",
                        }),
                        "kinderakten-verknuepfen-beispiel.csv",
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                    Beispieldatei
                  </Button>
                }
              >
                <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  <li>
                    Die Vertragsnummer steht auf der Seite des Vertrags unter
                    „Vertragsangaben“ bei „Vertrag Nr.“. Alle Nummern auf einmal
                    bekommst du in der Vertragsliste im Menü unter
                    „Herunterladen“.
                  </li>
                  <li>
                    Die Nummer der Kinderakte steht im OGS-Portal der Schule:
                    Öffne die Kinderakte. Die Zahl am Ende der Adresse ist die
                    Nummer, zum Beispiel …/students/123.
                  </li>
                  <li>
                    Name und Geburtsdatum vergleicht moto nur. Verknüpft wird
                    allein über die Nummern.
                  </li>
                  <li>
                    Eltern bekommen keine Nachricht, und es startet kein
                    Rechnungslauf.
                  </li>
                </ul>
                <Dropzone
                  accept=".csv,.txt,text/csv,text/plain"
                  legend="CSV-Datei mit Vertragsnummern und Kinderakten"
                  label="CSV-Datei hierher ziehen"
                  dragLabel="Datei hier loslassen"
                  buttonLabel="Datei wählen"
                  hint="Bis 2 MB. Getrennt mit Semikolon oder Komma, zum Beispiel aus Excel."
                  loading={reading}
                  loadingLabel="Datei wird gelesen …"
                  onFile={chooseFile}
                />
              </SectionCard>
            </div>
          )}
          {result ? (
            <div ref={focusOn(1)}>
              <CareContractChildLinkMappingCard
                headers={result.headers}
                columns={result.columns}
                unmapped={result.unmapped}
                disabled={applying}
                onChange={remap}
              />
            </div>
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
                    onClick={() => void read(file, result?.columns ?? null)}
                  >
                    Erneut prüfen
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {result && result.unmapped.length === 0 ? (
            <div ref={focusOn(2)} className="flex flex-col">
              <CareContractChildLinkPreviewCard
                result={result}
                fileName={file?.name ?? "datei.csv"}
                applying={applying}
                disabled={!verified}
                onApply={() => void apply()}
              />
            </div>
          ) : null}
          {result && result.unmapped.length > 0 ? (
            <Alert
              type="info"
              message="Ordne beide Spalten zu. Dann zeigt moto die Zeilen."
            />
          ) : null}
        </>
      )}
    </TenantPage>
  );
}
