"use client";

// Personal-Import des Trägers (#4724, ADR 0089 Abschnitt 5): Datei wählen,
// Spalten zuordnen, jede Zeile prüfen und die neuen und ergänzenden Zeilen
// übernehmen. moto erkennt eine Person nur an der Personalnummer: Eine neue
// Nummer wird eine neue Akte, eine bekannte ergänzt nur fehlende Bank- und
// Steuerdaten. Darum lässt sich dieselbe Datei wieder laden, ohne doppelte
// Akten. Die Datei bewahrt moto nicht auf; Bankdaten erscheinen nur verdeckt.

import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import { StaffImportLogCard } from "~/components/traeger/staff/staff-import-log-card";
import { StaffImportMappingCard } from "~/components/traeger/staff/staff-import-mapping-card";
import {
  STAFF_IMPORT_TEMPLATE,
  STAFF_IMPORT_TEMPLATE_NAME,
  staffImportDoneDescription,
  staffImportDoneTitle,
} from "~/components/traeger/staff/staff-import-format";
import { StaffImportPreviewCard } from "~/components/traeger/staff/staff-import-preview-card";
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
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  MAX_STAFF_IMPORT_FILE_BYTES,
  applyStaffImport,
  fetchStaffImportLog,
  previewStaffImport,
  type StaffImportMapping,
  type StaffImportResult,
} from "~/lib/traeger-staff-import-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerStaffImportPage" });

const STEPS = ["Datei wählen", "Spalten zuordnen", "Prüfen und übernehmen"];

const INFO =
  "Hier übernimmst du dein Personal aus dem Lohnprogramm oder einer Liste. moto erkennt jede Person an der Personalnummer. Eine neue Nummer wird eine neue Akte. Bei einer bekannten Nummer trägt moto nur fehlende Bank- und Steuerdaten ein. So entstehen keine doppelten Akten, auch wenn du die Datei noch einmal lädst. Die Datei bewahrt moto nicht auf.";

const PERSONAL = "/traeger/personal";

const FORMAT_LABELS: Record<string, string> = {
  ";": "Semikolon",
  ",": "Komma",
  "\t": "Tabulator",
};

function formatLabel(result: StaffImportResult): string {
  const encoding = result.encoding === "utf-8" ? "UTF-8" : "Windows-1252";
  return `${encoding}, getrennt mit ${FORMAT_LABELS[result.delimiter] ?? result.delimiter}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isCode(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === wireErrorCode(code);
}

export default function TraegerStaffImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<StaffImportResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<StaffImportResult | null>(null);
  const {
    data: log,
    error: loadError,
    failure,
    mutate: reloadLog,
  } = useTraegerResource(
    traegerStaffKeys.importLog(),
    fetchStaffImportLog,
    "den Personal-Import",
  );
  const locked = isCode(failure, "workforce.traeger_staff_not_released");
  const invalidateFamily = useInvalidateFamily();
  const { show, showMessage } = useApiErrorDisplay();
  const { success } = useToast();
  // Only the answer to the newest look at the file counts.
  const request = useRef(0);

  const read = useCallback(
    async (chosen: File, mapping: StaffImportMapping | null) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await previewStaffImport({ file: chosen, mapping });
        if (id === request.current) {
          setResult(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error("staff_import_preview_failed", { error: errorText(err) });
        if (id === request.current) void show(err, { object: "die Datei" });
      } finally {
        if (id === request.current) setReading(false);
      }
    },
    [show],
  );

  const choose = (chosen: File) => {
    if (!/\.(csv|txt)$/i.test(chosen.name)) {
      showMessage("Bitte wähle eine CSV-Datei.");
      return;
    }
    if (chosen.size > MAX_STAFF_IMPORT_FILE_BYTES) {
      showMessage("Die Datei ist zu groß. Erlaubt sind 2 MB.");
      return;
    }
    setFile(chosen);
    setResult(null);
    setDone(null);
    void read(chosen, null);
  };

  const remap = (mapping: StaffImportMapping) => {
    if (!file || !result || applying) return;
    setResult({ ...result, mapping });
    void read(file, mapping);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyStaffImport({
        file,
        mapping: result.mapping,
        fingerprint: result.fingerprint,
      });
      setDone(applied);
      success(`Übernommen: ${staffImportDoneTitle(applied.rows)}.`);
    } catch (err) {
      logger.error("staff_import_apply_failed", { error: errorText(err) });
      void show(err, { object: "das Personal" });
      if (isCode(err, "workforce.traeger_staff_import_changed")) {
        // The records changed since the office looked: show the current
        // rows; the import waits for a new confirmation.
        void read(file, result.mapping);
      }
      return;
    } finally {
      setApplying(false);
    }
    // Neue Akten stehen danach in der Liste der Personalakten.
    void invalidateFamily(traegerStaffKeys.overviewFamily);
    await reloadLog();
  };

  const restart = () => {
    request.current++;
    setFile(null);
    setResult(null);
    setVerified(false);
    setDone(null);
    setReading(false);
  };

  const downloadTemplate = () =>
    downloadBlob(
      // The BOM lets Excel read the umlauts as UTF-8.
      new Blob(["﻿", STAFF_IMPORT_TEMPLATE], {
        type: "text/csv;charset=utf-8",
      }),
      STAFF_IMPORT_TEMPLATE_NAME,
    );

  const step = !result ? 0 : result.unmapped.length > 0 ? 1 : 2;
  const error = locked ? null : loadError;
  const loading = !error && !locked && log === null;

  return (
    <TenantPage
      title="Personal importieren"
      info={INFO}
      back
      backHref={traegerPath(PERSONAL)}
      backLabel="Zurück zu den Personalakten"
      error={log ? null : error}
      loading={loading}
      actions={
        locked ? undefined : (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={downloadTemplate}
            className="gap-2"
            tooltip="Eine leere CSV-Datei mit den passenden Überschriften herunterladen."
          >
            <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
            Beispieldatei
          </Button>
        )
      }
    >
      {locked ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei, sobald dein Träger bestätigt hat: Es gibt eine Vereinbarung mit Betriebsrat oder Mitarbeitervertretung, oder es gibt keine Vertretung. Danach kannst du hier Personal importieren."
          />
        </SectionCard>
      ) : (
        <div className="flex flex-col gap-6">
          {done ? (
            <SectionCard>
              <EmptyState
                tone="success"
                icon={<CheckCircleIcon aria-hidden className="size-6" />}
                title={`Übernommen: ${staffImportDoneTitle(done.rows)}`}
                description={staffImportDoneDescription(done.counts)}
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    <ButtonLink
                      href={traegerPath(PERSONAL)}
                      variant="primary"
                      size="md"
                      tooltip="Öffnet die Personalakten mit den Vorschlägen zum Verknüpfen."
                    >
                      Zu den Personalakten
                    </ButtonLink>
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
                    // A long file name without spaces breaks anywhere
                    // instead of running past the card on a phone.
                    <span className="wrap-anywhere">
                      {result
                        ? `${file.name} · ${formatLabel(result)} · ${result.headers.length} Spalten${result.rows.length > 0 ? ` · ${result.rows.length} Zeilen` : ""}`
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
                  description="Eine CSV-Datei mit einer Zeile je Person und Überschriften in der ersten Zeile. Pflicht sind Personalnummer, Vorname und Nachname."
                >
                  <Dropzone
                    accept=".csv,.txt,text/csv,text/plain"
                    legend="CSV-Datei mit Personal"
                    label="CSV-Datei hierher ziehen"
                    dragLabel="Datei hier loslassen"
                    buttonLabel="Datei wählen"
                    hint="Bis 2 MB und 5.000 Zeilen. Getrennt mit Semikolon oder Komma, zum Beispiel aus Excel oder DATEV."
                    loading={reading}
                    loadingLabel="Datei wird gelesen …"
                    disabled={loading}
                    onFile={choose}
                  />
                </SectionCard>
              )}
              {result ? (
                <StaffImportMappingCard
                  headers={result.headers}
                  mapping={result.mapping}
                  unmapped={result.unmapped}
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
                    reading ? undefined : (
                      <Button
                        type="button"
                        variant="outline"
                        size="compact"
                        tooltip="Liest die Datei noch einmal und prüft jede Zeile."
                        onClick={() => void read(file, result?.mapping ?? null)}
                      >
                        Erneut prüfen
                      </Button>
                    )
                  }
                />
              ) : null}
              {result && result.unmapped.length === 0 ? (
                <StaffImportPreviewCard
                  result={result}
                  applying={applying}
                  disabled={!verified}
                  onApply={() => void apply()}
                />
              ) : null}
              {result && result.unmapped.length > 0 ? (
                <Alert
                  type="info"
                  message="Ordne Personalnummer, Vorname und Nachname einer Spalte zu. Dann zeigt moto die Zeilen."
                />
              ) : null}
            </>
          )}
          {log && error ? (
            <LoadErrorAlert error={error} />
          ) : log ? (
            <StaffImportLogCard entries={log} />
          ) : null}
        </div>
      )}
    </TenantPage>
  );
}
