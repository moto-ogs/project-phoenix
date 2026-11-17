"use client";

// Kinderzahl der Familien aus einer Datei nachtragen (#7356), zum Beispiel
// aus OGS Connect: Datei wählen, Spalten zuordnen, jede Zeile prüfen und die
// bereiten übernehmen. Jede Zeile nennt ein Kind mit Vertrag und die Zahl
// der Kinder seiner Familie. moto liest die Datei nur und bewahrt sie nicht
// auf. Eine schon bestätigte Zahl überschreibt die Datei nie.

import { CheckCircle, Download } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  FAMILY_IMPORT_SAMPLE,
  numberCountLabel,
} from "~/components/traeger/family-children-import-format";
import { FamilyChildrenImportMappingCard } from "~/components/traeger/family-children-import-mapping-card";
import { FamilyChildrenImportPreviewCard } from "~/components/traeger/family-children-import-preview-card";
import { importFormatLabel } from "~/components/traeger/sepa-import-format";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { Dropzone } from "~/components/ui/dropzone";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  MAX_FAMILY_IMPORT_FILE_BYTES,
  applyFamilyChildrenImport,
  previewFamilyChildrenImport,
  type FamilyImportMapping,
  type FamilyImportResult,
} from "~/lib/traeger-family-children-import-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerKinderzahlImportPage" });

const STEPS = ["Datei wählen", "Spalten zuordnen", "Prüfen und übernehmen"];

const INFO =
  "Hier tragen Sie die Kinderzahl vieler Familien auf einmal nach. Jede Zeile nennt ein Kind mit Vertrag und wie viele Kinder seine Familie hat. Die Zahl gilt als von Ihnen bestätigt. Eine schon bestätigte Zahl ändert moto nicht. Die Datei bewahrt moto nicht auf.";

const KINDERZAHL = "/traeger/abrechnung/kinderzahl";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function doneDescription(done: FamilyImportResult): string {
  const { counts } = done;
  const left = counts.conflict + counts.invalid + counts.differs;
  return `${counts.same} schon bestätigt, ${left} nicht übernommen. Die Zahlen stehen unter Kinderzahl mit dem Stand „Bestätigt“. Neue Monatsläufe rechnen damit.`;
}

export default function TraegerKinderzahlImportPage() {
  const invalidateFamily = useInvalidateFamily();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<FamilyImportResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<FamilyImportResult | null>(null);
  const { show, showMessage } = useApiErrorDisplay();
  const { success } = useToast();
  // Only the answer to the newest look at the file counts.
  const request = useRef(0);

  const read = useCallback(
    async (chosen: File, mapping: FamilyImportMapping | null) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await previewFamilyChildrenImport({
          file: chosen,
          mapping,
        });
        if (id === request.current) {
          setResult(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error("family_children_import_preview_failed", {
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
        "Bitte wählen Sie eine CSV-Datei. Eine Excel-Datei speichern Sie vorher als CSV.",
      );
      return;
    }
    if (chosen.size > MAX_FAMILY_IMPORT_FILE_BYTES) {
      showMessage("Die Datei ist zu groß. Erlaubt sind 2 MB.");
      return;
    }
    setFile(chosen);
    setResult(null);
    setDone(null);
    void read(chosen, null);
  };

  const remap = (mapping: FamilyImportMapping) => {
    if (!file || !result || applying) return;
    setResult({ ...result, mapping });
    void read(file, mapping);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyFamilyChildrenImport({
        file,
        mapping: result.mapping,
        fingerprint: result.fingerprint,
      });
      setDone(applied);
      success(`${numberCountLabel(applied.counts.imported)} übernommen.`);
      // The list of the numbers and the monthly runs read the new numbers.
      void invalidateFamily(traegerBillingKeys.childCounts());
    } catch (err) {
      logger.error("family_children_import_apply_failed", {
        error: errorText(err),
      });
      void show(err, { object: "die Kinderzahlen" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("parent_billing.sepa_import_changed")
      ) {
        // The rows changed since the office looked: show the current ones,
        // the import waits for a new confirmation.
        void read(file, result.mapping);
      }
    } finally {
      setApplying(false);
    }
  };

  const restart = () => {
    request.current++;
    setFile(null);
    setResult(null);
    setVerified(false);
    setDone(null);
    setReading(false);
  };

  const step = !result ? 0 : result.unmapped.length > 0 ? 1 : 2;

  return (
    <TenantPage
      title="Kinderzahl nachtragen"
      info={INFO}
      back
      backHref={traegerPath(KINDERZAHL)}
      backLabel="Zurück zur Kinderzahl"
    >
      <div className="flex flex-col gap-6">
        {done ? (
          <SectionCard>
            <EmptyState
              tone="success"
              icon={<CheckCircle aria-hidden className="size-6" />}
              title={`${numberCountLabel(done.counts.imported)} übernommen`}
              description={doneDescription(done)}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <ButtonLink
                    href={traegerPath(KINDERZAHL)}
                    variant="primary"
                    size="md"
                    tooltip="Öffnet die Liste der Familien mit ihrer Kinderzahl."
                  >
                    Zur Kinderzahl
                  </ButtonLink>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={restart}
                    disabled={applying}
                    tooltip="Startet das Nachtragen mit einer anderen Datei."
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
                description="Eine CSV-Datei mit einer Zeile je Kind und Überschriften in der ersten Zeile."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    tooltip="Speichert eine Beispieldatei mit allen Spalten, die moto von selbst erkennt."
                    onClick={() =>
                      downloadBlob(
                        new Blob(["﻿", FAMILY_IMPORT_SAMPLE], {
                          type: "text/csv;charset=utf-8",
                        }),
                        "kinderzahl-beispiel.csv",
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
                  legend="CSV-Datei mit Kindern und der Kinderzahl ihrer Familie"
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
              <FamilyChildrenImportMappingCard
                headers={result.headers}
                mapping={result.mapping}
                unmapped={result.unmapped}
                schools={result.schools}
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
                    : "Die Datei ist noch nicht geprüft. Bitte prüfen Sie erneut."
                }
                action={
                  !reading ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      tooltip="Liest die Datei noch einmal und prüft jede Zeile."
                      onClick={() => void read(file, result?.mapping ?? null)}
                    >
                      Erneut prüfen
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {result && result.unmapped.length === 0 ? (
              <FamilyChildrenImportPreviewCard
                result={result}
                applying={applying}
                disabled={!verified}
                onApply={() => void apply()}
              />
            ) : null}
            {result && result.unmapped.length > 0 ? (
              <Alert
                type="info"
                message="Ordnen Sie alle Pflichtfelder zu. Dann zeigt moto die Zeilen."
              />
            ) : null}
          </>
        )}
      </div>
    </TenantPage>
  );
}
