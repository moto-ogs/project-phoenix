"use client";

// Sammelimport für Klassenlisteneinträge (#2382): CSV/Excel mit genau drei
// Spalten (Vorname, Nachname, Klasse). Bereits vorhandene Einträge und
// bereits regulär angelegte Kinder werden übersprungen, sie stehen schon
// auf der Klassenliste.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Download, Info, ListChecks } from "lucide-react";
import { SkeletonRegion, FormSkeleton } from "~/components/ui/page-skeletons";
import { Button } from "~/components/ui/button";
import { FormRow } from "~/components/ui/form-row";
import { StickyActionBar } from "~/components/ui/sticky-action-bar";
import { CustomSelect } from "~/components/ui/custom-select";
import { SectionCard } from "~/components/ui/section-card";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { UploadSection } from "~/components/import/upload-section";
import {
  DISCARD_UPLOAD_HINT,
  TEMPLATE_DOWNLOAD_HINT,
} from "~/components/import/import-hints";
import { StatsCards } from "~/components/import/stats-cards";
import { StudentRowCard } from "~/components/import/student-row-card";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import {
  downloadImportTemplate,
  importFailureBody,
} from "~/lib/import-request";
import { bffJson } from "~/lib/bff-fetch";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import {
  countAlreadyExistsRows,
  importBatchFailureMessage,
  importBatchSavedCount,
  readImportBatchFailure,
} from "~/lib/import-batch-result";
import * as importContract from "~/lib/contract/import.generated";
import { createLogger } from "~/lib/logger";

/** Info-Knopf am Seitentitel: wofür die Seite da ist und was man zuerst tut. */
const CLASS_LIST_IMPORT_INFO =
  "Hier setzt du viele Kinder auf einmal auf die Klassenliste. Lade zuerst die Vorlage herunter.";

const logger = createLogger({ component: "ClassListImportPage" });

type RowStatus = "new" | "existing" | "error" | "warning";

interface DisplayEntry {
  row: number;
  status: RowStatus;
  errors: string[];
  firstName: string;
  lastName: string;
  schoolClass: string;
}

function rowStatusFor(
  findings: readonly importContract.ValidationError[] | null,
): RowStatus {
  const errors = findings ?? [];
  const isExisting = errors.some((e) => e.code === "already_exists");
  if (isExisting) return "existing";
  if (errors.some((e) => e.severity === "error")) return "error";
  if (errors.some((e) => e.severity === "warning")) return "warning";
  return "new";
}

function toDisplayEntry(
  row: importContract.ClassListImportError,
): DisplayEntry {
  return {
    row: row.row_number,
    status: rowStatusFor(row.errors),
    errors: (row.errors ?? []).map((e) => e.message),
    firstName: row.data.first_name,
    lastName: row.data.last_name,
    schoolClass: row.data.school_class,
  };
}

export default function ClassListImportPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<DisplayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importInterrupted, setImportInterrupted] = useState(false);
  const [importResult, setImportResult] =
    useState<importContract.ClassListImportResult | null>(null);
  // Fehler der Datei und des Imports stehen im Kasten über der Vorlage,
  // mit Wiederholen (#2517). Ein angehaltener Stapel steht dort auch, mit
  // oder ohne gespeicherte Zeilen: der Import als Ganzes ist gescheitert.
  const importErrors = useApiFormError();
  const { show: showTemplateError } = useApiErrorDisplay();
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const latestImportRef = useRef<() => void>(() => undefined);
  const [templateFormat, setTemplateFormat] = useState<"csv" | "xlsx">("xlsx");

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });
  // Der Import legt Einträge an, dieselbe Hürde wie das Backend
  // (/api/import/class-list-entries verlangt users:create). Wer sie nicht
  // nimmt, wird zum Dashboard umgeleitet statt in einen 403 zu laufen.
  const { isReady } = useRequirePermission("users:create");

  const toast = useToast();

  const resetForm = useCallback(() => {
    setUploadedFile(null);
    setPreviewData([]);
    setIsLoading(false);
    setIsImporting(false);
    setImportComplete(false);
    setImportInterrupted(false);
    setImportResult(null);
    importErrors.clear();
    setBatchNotice(null);
  }, [importErrors]);

  const handleDownloadTemplate = async () => {
    try {
      await downloadImportTemplate(
        "GET /api/import/class-list-entries/template",
        templateFormat,
        templateFormat === "xlsx"
          ? "klassenliste-import-vorlage.xlsx"
          : "klassenliste-import-vorlage.csv",
      );
    } catch (err) {
      logger.error("template_download_failed", {
        error: err instanceof Error ? err.message : String(err),
        format: templateFormat,
      });
      // Eine Aktion ohne Formular: Toast mit Wiederholen.
      void showTemplateError(err, {
        object: "die Vorlage",
        retry: () => void handleDownloadTemplate(),
      });
    }
  };

  const handleFileUpload = useCallback(
    async (file: File) => {
      setUploadedFile(file);
      importErrors.clear();
      setBatchNotice(null);
      setIsLoading(true);
      setImportComplete(false);
      setImportInterrupted(false);
      setImportResult(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const importData: importContract.ClassListImportResult = await bffJson(
          "tenant",
          "POST /api/import/class-list-entries/preview",
          { body: formData, errorMessage: "Class list preview failed" },
        );
        const displayData: DisplayEntry[] = (importData.errors ?? []).map(
          toDisplayEntry,
        );

        // Rows without issues are not in the Errors array — summarise them.
        const newCount = importData.total_rows - displayData.length;
        if (newCount > 0 && displayData.length === 0) {
          displayData.push({
            row: 0,
            status: "new",
            errors: [],
            firstName: `${importData.total_rows} Einträge`,
            lastName: "bereit zum Import",
            schoolClass: "",
          });
        }

        setPreviewData(displayData);
        setImportResult(importData);
      } catch (err) {
        logger.error("class_list_preview_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        void importErrors.show(err, {
          object: "die Datei",
          retry: () => void handleFileUpload(file),
        });
        setPreviewData([]);
      } finally {
        setIsLoading(false);
      }
    },
    [importErrors],
  );

  const handleImport = async () => {
    if (!uploadedFile) return;

    setIsImporting(true);
    importErrors.clear();
    setBatchNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      let importData: importContract.ClassListImportResult;
      try {
        importData = await bffJson(
          "tenant",
          "POST /api/import/class-list-entries/import",
          { body: formData, errorMessage: "Class list import failed" },
        );
      } catch (error) {
        // A stopped batch carries the rows already saved in its error body.
        const result = importFailureBody(error);
        const interrupted = readImportBatchFailure(
          result,
          importContract.ClassListImportResultSchema,
        );
        if (interrupted) {
          setImportResult(interrupted);
          setImportInterrupted(true);
          setPreviewData((interrupted.errors ?? []).map(toDisplayEntry));
          setBatchNotice(importBatchFailureMessage(interrupted));
          logger.error("class_list_import_batch_failed", {
            created: interrupted.created_count,
            updated: interrupted.updated_count,
            errors: interrupted.error_count,
          });
          return;
        }
        throw error;
      }
      setImportResult(importData);
      setImportInterrupted(false);

      if (importData.error_count > 0) {
        // Partial success: keep preview visible so the user sees which rows
        // were skipped (already on the class list) or failed.
        setPreviewData((importData.errors ?? []).map(toDisplayEntry));
        const skipped = countAlreadyExistsRows(importData.errors);
        const failed = importData.error_count - skipped;
        toast.warning(
          `Der Import ist fertig: ${importData.created_count} angelegt, ${skipped} übersprungen` +
            (failed > 0 ? `, ${failed} fehlgeschlagen.` : "."),
        );
      } else {
        setImportComplete(true);
        toast.success(
          importData.created_count === 1
            ? "1 Eintrag ist angelegt."
            : `${importData.created_count} Einträge sind angelegt.`,
        );
        resetForm();
      }
    } catch (err) {
      logger.error("class_list_import_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void importErrors.show(err, {
        object: "das Importieren der Datei",
        retry: () => latestImportRef.current(),
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Wiederholen importiert die Datei, die dann gewählt ist.
  useLayoutEffect(() => {
    latestImportRef.current = () => void handleImport();
  });

  // Beim Ablegen greift der Filter des Dateidialogs nicht, deshalb die Prüfung
  // hier für beide Wege.
  const handleFileChosen = (file: File) => {
    if (
      file.type === "text/csv" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.name.toLowerCase().endsWith(".csv") ||
      file.name.toLowerCase().endsWith(".xlsx")
    ) {
      void handleFileUpload(file);
    } else {
      importErrors.invalid(
        "Diese Datei passt nicht. Bitte lade eine CSV- oder Excel-Datei hoch.",
      );
    }
  };

  const existingCount = countAlreadyExistsRows(importResult?.errors);
  const stats = {
    total: importResult?.total_rows ?? 0,
    new: importResult?.created_count ?? 0,
    existing: existingCount,
    errors: (importResult?.error_count ?? 0) - existingCount,
  };

  // Statuszeile des Seitenkopfs: der Stand des Imports.
  const savedCount = importResult ? importBatchSavedCount(importResult) : 0;
  const statusLine = uploadedFile ? (
    <TenantPageStats
      items={[
        { label: uploadedFile.name },
        importComplete
          ? { label: "Import abgeschlossen" }
          : importInterrupted
            ? { value: savedCount, label: "gespeichert" }
            : {
                value: stats.total,
                label: stats.total === 1 ? "Zeile" : "Zeilen",
              },
        ...(!importComplete && stats.errors > 0
          ? [{ value: stats.errors, label: "Fehler" }]
          : []),
      ]}
    />
  ) : (
    "Noch keine Datei gewählt"
  );

  if (status === "loading" || !isReady) {
    return (
      <TenantPage
        title="Klassenliste importieren"
        info={CLASS_LIST_IMPORT_INFO}
        stats={statusLine}
        back
        backHref="/database/students/class-list"
        backLabel="Zurück zur Klassenliste"
      >
        <SkeletonRegion label="Klassenlisten-Import wird geladen…">
          <FormSkeleton fields={2} />
        </SkeletonRegion>
      </TenantPage>
    );
  }

  return (
    <TenantPage
      title="Klassenliste importieren"
      info={CLASS_LIST_IMPORT_INFO}
      stats={statusLine}
      back
      backHref="/database/students/class-list"
      backLabel="Zurück zur Klassenliste"
    >
      {/* Info Section */}
      <SectionCard title="Sammelimport für Klassenlisteneinträge" icon={Info}>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>Lade die Vorlage herunter (siehe unten)</li>
          <li>
            Trage ab Zeile 2 pro Kind nur Vorname, Nachname und Klasse ein. Mehr
            braucht ein Klassenlisteneintrag nicht
          </li>
          <li>
            Kinder, die bereits in moto angelegt sind, werden übersprungen, sie
            stehen schon auf der Klassenliste
          </li>
          <li>Lade die Datei hier hoch und überprüfe die Vorschau</li>
          <li>Bestätige den Import</li>
        </ul>
      </SectionCard>

      <FormErrorAlert message={importErrors.error ?? batchNotice} />

      {/* Download Template */}
      <SectionCard title="Vorlage herunterladen" icon={Download}>
        <FormRow>
          <CustomSelect
            id="format-select"
            label="Format wählen"
            value={templateFormat}
            options={[
              { value: "csv", label: "CSV (Komma-getrennt)" },
              { value: "xlsx", label: "Excel (.xlsx)" },
            ]}
            onChange={(next) => setTemplateFormat(next as "csv" | "xlsx")}
          />
          <Button
            type="button"
            variant="primary"
            size="field"
            tooltip={TEMPLATE_DOWNLOAD_HINT}
            onClick={() => void handleDownloadTemplate()}
            className="gap-2"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            Vorlage herunterladen
          </Button>
        </FormRow>
        <p className="mt-3 text-sm text-gray-500">
          Spalten: <span className="font-medium">Vorname</span>,{" "}
          <span className="font-medium">Nachname</span>,{" "}
          <span className="font-medium">Klasse</span>
        </p>
      </SectionCard>

      {/* Upload Section */}
      <UploadSection
        isLoading={isLoading}
        uploadedFile={uploadedFile}
        onFileSelect={handleFileChosen}
      />

      {/* Preview Section */}
      {(previewData.length > 0 || importInterrupted) && !importComplete && (
        <>
          <StatsCards
            total={stats.total}
            newCount={stats.new}
            existing={stats.existing}
            errors={stats.errors}
          />

          {previewData.length > 0 && (
            <SectionCard title="Datenvorschau" icon={ListChecks}>
              <div className="space-y-2">
                {previewData.map((entry, idx) => (
                  <StudentRowCard
                    key={entry.row}
                    student={{
                      row: entry.row,
                      status: entry.status,
                      errors: entry.errors,
                      firstName: entry.firstName,
                      lastName: entry.lastName,
                      meta: [entry.schoolClass],
                    }}
                    index={idx}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          <StickyActionBar reserveSpace>
            <Button
              type="button"
              variant="outline"
              size="md"
              className="flex-1"
              tooltip={DISCARD_UPLOAD_HINT}
              onClick={resetForm}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="success"
              size="md"
              className="flex-1"
              onClick={() => void handleImport()}
              disabled={(!importInterrupted && stats.new === 0) || isImporting}
              disabledReason={
                isImporting
                  ? undefined
                  : "Die Datei enthält keine neuen Einträge."
              }
              tooltip="Setzt die neuen Kinder ohne OGS-Betreuung auf die Klassenlisten."
            >
              {isImporting
                ? "Wird importiert…"
                : importInterrupted
                  ? "Erneut versuchen"
                  : `${stats.new} Einträge importieren`}
            </Button>
          </StickyActionBar>
        </>
      )}
    </TenantPage>
  );
}
