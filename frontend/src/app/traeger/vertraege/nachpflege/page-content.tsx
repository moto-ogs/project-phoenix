"use client";

// Vertragsangaben importierter Verträge nachpflegen (#7767): Der Import
// kannte nur „auf Papier“, höchstens eine Vertragspartei und ein
// Abschlussdatum. Hier lädt das Träger-Büro die Liste aller importierten
// Verträge herunter, ergänzt sie aus den Originalunterlagen und lädt sie
// wieder hoch. moto zeigt je Zeile, was sich ändert, und ändert erst nach
// der Bestätigung. Eine erneut hochgeladene Liste ändert nichts mehr.

import { Download } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useRef, useState } from "react";
import { CareContractCorrectionLogCard } from "~/components/traeger/care-contract-correction-log-card";
import { CareContractCorrectionPreviewCard } from "~/components/traeger/care-contract-correction-preview-card";
import { missingColumnsText } from "~/components/traeger/care-contract-correction-format";
import { contractCountLabel } from "~/components/traeger/care-contract-import-format";
import { importFormatLabel } from "~/components/traeger/sepa-import-format";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { Dropzone } from "~/components/ui/dropzone";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { hasPermission } from "~/lib/auth-utils";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  MAX_CONTRACT_CORRECTION_FILE_BYTES,
  applyContractCorrections,
  downloadContractCorrectionList,
  fetchContractCorrectionLog,
  previewContractCorrections,
  type ContractCorrectionRun,
} from "~/lib/traeger-contract-correction-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerContractCorrectionPage" });

const INFO =
  "Hier ergänzt du importierte Verträge aus den Originalunterlagen: Vertragsparteien, Abschlussart und Abschlussdatum. Es entsteht kein neuer Vertrag. Eltern bekommen keine Mail. Lädst du dieselbe Liste noch einmal hoch, ändert sich nichts.";

const VERTRAEGE = "/traeger/vertraege";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How to fill in the list, column by column. */
function ListRules() {
  return (
    <DataGrid>
      <DataField label="Vertragsparteien">
        <span className="font-normal">
          Namen als „Nachname, Vorname“, getrennt mit „ | “. Ein weiterer Name
          kommt dazu. Schreibst du einen Namen anders, ändert moto die
          Schreibweise. Vor- oder Nachname muss dabei gleich bleiben. Ändere in
          der Liste nur einen Namen pro Vertrag. Keine Partei fällt weg,
          Mail-Adresse und Elternkonto bleiben.
        </span>
      </DataField>
      <DataField label="Abschlussart">
        <span className="font-normal">„online“ oder „papier“.</span>
      </DataField>
      <DataField label="Abschlussdatum">
        <span className="font-normal">
          Als TT.MM.JJJJ, zum Beispiel 12.03.2026. Fehlt der Beleg für den Tag,
          schreibe „unbekannt“.
        </span>
      </DataField>
      <DataField label="Beleg">
        <span className="font-normal">
          Pflicht in jeder Zeile, die etwas ändert. Zum Beispiel der Name der
          PDF mit dem Vertrag.
        </span>
      </DataField>
      <DataField label="Vertrag-ID und Kind">
        <span className="font-normal">
          Nicht ändern. Daran erkennt moto den Vertrag.
        </span>
      </DataField>
      <DataField label="Leere Zelle">
        <span className="font-normal">Der Wert bleibt, wie er ist.</span>
      </DataField>
    </DataGrid>
  );
}

export default function TraegerContractCorrectionPage() {
  const { data: session } = useSession();
  const canManage = hasPermission(session ?? null, "traeger_contracts:manage");
  const {
    data: log,
    error: logError,
    mutate: mutateLog,
  } = useTraegerResource(
    canManage ? traegerContractKeys.correctionLog() : null,
    fetchContractCorrectionLog,
    "die Liste der nachgepflegten Verträge",
  );
  const invalidateFamily = useInvalidateFamily();
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<ContractCorrectionRun | null>(null);
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const { show, showMessage } = useApiErrorDisplay();
  const { success } = useToast();
  // Only the answer to the newest look at the file counts.
  const request = useRef(0);

  const read = useCallback(
    async (chosen: File) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await previewContractCorrections({ file: chosen });
        if (id === request.current) {
          setRun(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error("contract_correction_preview_failed", {
          error: errorText(err),
        });
        if (id === request.current) void show(err, { object: "die Liste" });
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
    if (chosen.size > MAX_CONTRACT_CORRECTION_FILE_BYTES) {
      showMessage("Die Datei ist zu groß. Erlaubt sind 2 MB.");
      return;
    }
    setFile(chosen);
    setRun(null);
    void read(chosen);
  };

  const download = async () => {
    setDownloading(true);
    try {
      const list = await downloadContractCorrectionList();
      downloadBlob(list.blob, list.filename);
    } catch (err) {
      logger.error("contract_correction_list_failed", {
        error: errorText(err),
      });
      void show(err, { object: "die Liste" });
    } finally {
      setDownloading(false);
    }
  };

  const apply = async () => {
    if (!file || !run || !verified || reading || applying) return;
    setApplying(true);
    try {
      const applied = await applyContractCorrections({
        file,
        fingerprint: run.fingerprint,
      });
      setRun(applied);
      success(`${contractCountLabel(applied.counts.corrected)} geändert.`);
    } catch (err) {
      logger.error("contract_correction_apply_failed", {
        error: errorText(err),
      });
      void show(err, { object: "die Verträge" });
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.import_changed")
      ) {
        // The contracts changed since the office looked: show the current
        // rows, the change waits for a new confirmation.
        void read(file);
      }
      return;
    } finally {
      setApplying(false);
      setConfirming(false);
    }
    // The list and every contract page show the new parties and conclusion.
    void invalidateFamily(traegerContractKeys.listFamily);
    void invalidateFamily(traegerContractKeys.detailFamily);
    await mutateLog();
  };

  const restart = () => {
    request.current++;
    setFile(null);
    setRun(null);
    setVerified(false);
    setReading(false);
  };

  const changing = run?.counts.change ?? 0;
  const invalid = run?.counts.invalid ?? 0;

  return (
    <TenantPage
      title="Vertragsangaben nachpflegen"
      info={INFO}
      back
      backHref={traegerPath(VERTRAEGE)}
      backLabel="Zurück zu den Verträgen"
      overlays={
        <ConfirmationModal
          isOpen={confirming}
          title="Vertragsangaben ändern?"
          confirmText={`${contractCountLabel(changing)} ändern`}
          confirmVariant="success"
          confirmTooltip="Ändert die Angaben der Verträge sofort."
          isConfirmLoading={applying}
          loadingText="Wird geändert …"
          onClose={() => setConfirming(false)}
          onConfirm={() => void apply()}
        >
          <p className="text-sm text-gray-700">
            {changing === 1
              ? "1 Vertrag wird geändert."
              : `${changing} Verträge werden geändert.`}{" "}
            Es entsteht kein neuer Vertrag und es geht keine Mail raus.
            {invalid > 0 &&
              (invalid === 1
                ? " 1 Zeile mit Fehler bleibt, wie sie ist."
                : ` ${invalid} Zeilen mit Fehler bleiben, wie sie sind.`)}
          </p>
        </ConfirmationModal>
      }
    >
      <SectionCard
        title="1. Liste herunterladen"
        description="Die Liste enthält alle importierten Verträge mit ihren Angaben in moto. Ergänze sie aus den Originalunterlagen."
        action={
          <Button
            type="button"
            variant="outline"
            size="md"
            isLoading={downloading}
            loadingText="Wird geladen …"
            tooltip="Speichert alle importierten Verträge als CSV-Datei."
            onClick={() => void download()}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Liste herunterladen
          </Button>
        }
      >
        <ListRules />
      </SectionCard>
      <SectionCard
        title="2. Ausgefüllte Liste hochladen"
        description={
          file ? (
            // A long file name without spaces breaks anywhere instead of
            // running past the card on a phone.
            <span className="wrap-anywhere">
              {run
                ? `${file.name} · ${importFormatLabel(run.encoding, run.delimiter)} · ${run.rows.length === 1 ? "1 Zeile" : `${run.rows.length} Zeilen`}`
                : file.name}
            </span>
          ) : (
            "Speichere die Liste als CSV-Datei. Excel kann das unter „Speichern unter“."
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
              tooltip="Verwirft die gelesene Liste, ohne etwas zu ändern."
            >
              Andere Datei
            </Button>
          ) : undefined
        }
      >
        {file ? null : (
          <Dropzone
            accept=".csv,.txt,text/csv,text/plain"
            legend="Ausgefüllte Liste als CSV-Datei"
            label="CSV-Datei hierher ziehen"
            dragLabel="Datei hier loslassen"
            buttonLabel="Datei wählen"
            hint="Bis 2 MB. Getrennt mit Semikolon oder Komma."
            loading={reading}
            loadingLabel="Datei wird gelesen …"
            onFile={choose}
          />
        )}
      </SectionCard>
      {file && !verified ? (
        <Alert
          type="info"
          message={
            reading
              ? "Die Liste wird geprüft …"
              : "Die Liste ist noch nicht geprüft. Bitte prüfe erneut."
          }
          action={
            !reading ? (
              <Button
                type="button"
                variant="ghost_tone"
                size="compact"
                tooltip="Liest die Liste noch einmal und prüft jede Zeile."
                onClick={() => void read(file)}
              >
                Erneut prüfen
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {run && run.missing.length > 0 ? (
        <Alert
          type="warning"
          title="Der Datei fehlen Spalten"
          message={`${missingColumnsText(run.missing)} Lade die Liste oben herunter, sie hat alle Spalten. Trage deine Angaben dort ein.`}
        />
      ) : null}
      {run && run.missing.length === 0 ? (
        <CareContractCorrectionPreviewCard
          run={run}
          applying={applying}
          disabled={!verified}
          onApply={() => setConfirming(true)}
          onRestart={restart}
        />
      ) : null}
      {logError ? (
        <LoadErrorAlert error={logError} />
      ) : log ? (
        <CareContractCorrectionLogCard entries={log} />
      ) : null}
    </TenantPage>
  );
}
