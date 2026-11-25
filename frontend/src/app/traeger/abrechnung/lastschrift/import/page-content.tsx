"use client";

// Import bestehender SEPA-Mandate (#6198), zum Beispiel aus OGS Connect: Datei
// wählen, Spalten zuordnen, jede Zeile prüfen und die bereiten übernehmen.
// moto liest die Datei nur und bewahrt sie nicht auf; die IBAN erscheint nur
// verdeckt. Eine Datei lässt sich nach Korrekturen wieder laden: was schon
// übernommen ist, zeigt moto als „Schon vorhanden“.

import { CheckCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useRef, useState } from "react";
import { SepaImportLogCard } from "~/components/traeger/sepa-import-log-card";
import { SepaImportMappingCard } from "~/components/traeger/sepa-import-mapping-card";
import {
  importFormatLabel,
  importChangesLabel,
} from "~/components/traeger/sepa-import-format";
import { SepaImportPreviewCard } from "~/components/traeger/sepa-import-preview-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { Dropzone } from "~/components/ui/dropzone";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import {
  useApiErrorDisplay,
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { hasPermission } from "~/lib/auth-utils";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchSepaCreditor,
  type MandateSequence,
} from "~/lib/traeger-sepa-api";
import {
  MAX_IMPORT_FILE_BYTES,
  applySepaImport,
  fetchSepaImportLog,
  previewSepaImport,
  type ImportMapping,
  type ImportResult,
} from "~/lib/traeger-sepa-import-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerSepaImportPage" });

const STEPS = ["Datei wählen", "Spalten zuordnen", "Prüfen und übernehmen"];

const INFO =
  "Hier übernimmst du Mandate, die du schon in einem anderen Programm hast. Referenz und Datum der Unterschrift bleiben gleich. Die Datei bewahrt moto nicht auf.";

const LASTSCHRIFT = "/traeger/abrechnung/lastschrift";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function TraegerSepaImportPage() {
  const { data: session } = useSession();
  const canBill = hasPermission(session ?? null, "traeger_billing:manage");
  const creditor = useTraegerResource(
    canBill ? traegerKeys.sepaCreditor() : null,
    fetchSepaCreditor,
    "den Import",
  );
  const logRead = useTraegerResource(
    canBill ? traegerBillingRunKeys.sepaImportLog() : null,
    fetchSepaImportLog,
    "den Import",
  );
  const creditorId = creditor.data?.creditorId ?? null;
  const log = logRead.data;
  const pageError = creditor.error ?? logRead.error;
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [answers, setAnswers] = useState<Record<number, MandateSequence>>({});
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  // The list after an import: a failure keeps the import and retries only
  // the list.
  const logLoad = useApiLoadError();
  const { show: showLogError, clear: clearLogError } = logLoad;
  const { show, showMessage } = useApiErrorDisplay();
  const { success } = useToast();
  // Only the answer to the newest look at the file counts.
  const request = useRef(0);

  const { mutate: mutateLog } = logRead;
  const invalidateFamily = useInvalidateFamily();
  const loadLog = useCallback(async () => {
    try {
      await mutateLog(fetchSepaImportLog(), { revalidate: false });
      clearLogError();
    } catch (err) {
      logger.error("sepa_import_log_load_failed", { error: errorText(err) });
      await showLogError(err, {
        object: "die Liste der Importe",
        action: { label: "Erneut laden", onClick: () => void loadLog() },
      });
    }
  }, [mutateLog, clearLogError, showLogError]);

  const read = useCallback(
    async (
      chosen: File,
      mapping: ImportMapping | null,
      sequences: Readonly<Record<number, MandateSequence>> = {},
    ) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await previewSepaImport({
          file: chosen,
          mapping,
          sequences,
        });
        if (id === request.current) {
          setResult(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error("sepa_import_preview_failed", { error: errorText(err) });
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
    if (chosen.size > MAX_IMPORT_FILE_BYTES) {
      showMessage("Die Datei ist zu groß. Erlaubt sind 2 MB.");
      return;
    }
    setFile(chosen);
    setResult(null);
    setAnswers({});
    setDone(null);
    void read(chosen, null);
  };

  const remap = (mapping: ImportMapping) => {
    if (!file || !result || applying) return;
    setResult({ ...result, mapping });
    setAnswers({});
    void read(file, mapping);
  };

  const answer = (line: number, sequence: MandateSequence) => {
    if (!file || !result || applying) return;
    const next = { ...answers, [line]: sequence };
    setAnswers(next);
    void read(file, result.mapping, next);
  };

  const apply = async () => {
    if (!file || !result || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applySepaImport({
        file,
        mapping: result.mapping,
        sequences: answers,
        fingerprint: result.fingerprint,
      });
      setDone(applied);
      // The mandates of the contracts, and the families' debtor numbers the
      // file carried.
      void invalidateFamily(traegerBillingRunKeys.sepaMandatesFamily);
      if (applied.counts.debtorNumbers > 0) {
        void invalidateFamily(traegerBillingKeys.familiesFamily);
      }
      success(
        `${importChangesLabel(applied.counts.imported, applied.counts.debtorNumbers)} übernommen.`,
      );
    } catch (err) {
      logger.error("sepa_import_apply_failed", { error: errorText(err) });
      void show(err, { object: "die Mandate" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("parent_billing.sepa_import_changed")
      ) {
        // The rows changed since the office looked: show the current ones,
        // the import waits for a new confirmation.
        void read(file, result.mapping, answers);
      }
      return;
    } finally {
      setApplying(false);
    }
    await loadLog();
  };

  const restart = () => {
    request.current++;
    setFile(null);
    setResult(null);
    setVerified(false);
    setAnswers({});
    setDone(null);
    setReading(false);
  };

  const step = !result ? 0 : result.unmapped.length > 0 ? 1 : 2;
  // A read file, the import and a restart replace the control the person
  // used (file choice, Übernehmen, Weitere Datei): the heading of the card
  // that now asks for something takes the focus (#7111). Mapping the last
  // column turns step 1 into step 2 under the person's hand; that moves
  // nothing (WCAG 3.2.2).
  const phase = done ? "done" : result ? "result" : "file";
  const stepFocus = useStepFocus<HTMLDivElement>(phase);
  const focusOn = (target: number | "done") =>
    (done ? target === "done" : target === step) ? stepFocus : undefined;
  const loading =
    canBill && !pageError && (creditorId === null || log === null);
  const missingCreditor = creditorId === "";

  return (
    <TenantPage
      title="Mandate importieren"
      info={INFO}
      back
      backHref={traegerPath(LASTSCHRIFT)}
      backLabel="Zurück zur Lastschrift"
      error={pageError}
      loading={loading}
    >
      {done ? (
        <div ref={focusOn("done")}>
          <SectionCard>
            <EmptyState
              tone="success"
              icon={<CheckCircle aria-hidden className="size-6" />}
              titleAs="h2"
              title={`${importChangesLabel(done.counts.imported, done.counts.debtorNumbers)} übernommen`}
              description={`Mandate: ${done.counts.duplicate} schon vorhanden, ${done.counts.clarify + done.counts.conflict + done.counts.invalid} nicht übernommen. Du findest Mandate unter Lastschrift und Debitorennummern bei der Familie.`}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <ButtonLink
                    href={traegerPath(LASTSCHRIFT)}
                    variant="primary"
                    size="md"
                    tooltip="Öffnet die Lastschrift mit allen Mandaten."
                  >
                    Zur Lastschrift
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
        </div>
      ) : (
        <>
          <SectionCard>
            <WizardStepper steps={STEPS} current={step} />
          </SectionCard>
          {missingCreditor ? (
            <Alert
              type="warning"
              title="Zuerst die Gläubiger-ID eintragen"
              message="Ein Mandat gilt immer für eine Gläubiger-ID. Trage deine unter Einstellungen → Abrechnung ein."
              action={
                <ButtonLink
                  href={traegerPath("/traeger/einstellungen/abrechnung")}
                  variant="surface"
                  size="compact"
                  tooltip="Öffnet die Einstellungen der Abrechnung für die Gläubiger-ID."
                >
                  Zu den Einstellungen
                </ButtonLink>
              }
            />
          ) : null}
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
            <div ref={focusOn(0)}>
              <SectionCard
                title="Datei wählen"
                description="Eine CSV-Datei mit einer Zeile je Mandat und Überschriften in der ersten Zeile."
              >
                <Dropzone
                  accept=".csv,.txt,text/csv,text/plain"
                  legend="CSV-Datei mit Mandaten"
                  label="CSV-Datei hierher ziehen"
                  dragLabel="Datei hier loslassen"
                  buttonLabel="Datei wählen"
                  hint="Bis 2 MB. Getrennt mit Semikolon oder Komma, aus Excel oder einem anderen Programm."
                  loading={reading}
                  loadingLabel="Datei wird gelesen …"
                  disabled={missingCreditor || loading}
                  onFile={choose}
                />
              </SectionCard>
            </div>
          )}
          {result ? (
            <div ref={focusOn(1)}>
              <SepaImportMappingCard
                headers={result.headers}
                mapping={result.mapping}
                unmapped={result.unmapped}
                creditorId={result.creditorId}
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
                    onClick={() =>
                      void read(file, result?.mapping ?? null, answers)
                    }
                  >
                    Erneut prüfen
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {result && result.unmapped.length === 0 ? (
            <div ref={focusOn(2)}>
              <SepaImportPreviewCard
                result={result}
                answers={answers}
                applying={applying}
                disabled={!verified}
                onAnswer={answer}
                onApply={() => void apply()}
              />
            </div>
          ) : null}
          {result && result.unmapped.length > 0 ? (
            <Alert
              type="info"
              message={
                result.unmapped.includes("creditor_id") &&
                result.unmapped.length === 1
                  ? "Bestätige die Gläubiger-ID. Dann zeigt moto die Zeilen."
                  : "Ordne alle Pflichtfelder zu. Dann zeigt moto die Zeilen."
              }
            />
          ) : null}
        </>
      )}
      {logLoad.error ? (
        <LoadErrorAlert error={logLoad.error} />
      ) : log ? (
        <SepaImportLogCard entries={log} />
      ) : null}
    </TenantPage>
  );
}
