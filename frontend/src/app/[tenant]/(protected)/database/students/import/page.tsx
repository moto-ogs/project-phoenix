"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Download, Info, ListChecks, RefreshCw } from "lucide-react";
import { SkeletonRegion, FormSkeleton } from "~/components/ui/page-skeletons";
import { Button } from "~/components/ui/button";
import { FormRow } from "~/components/ui/form-row";
import { StickyActionBar } from "~/components/ui/sticky-action-bar";
import { CustomSelect } from "~/components/ui/custom-select";
import { Alert } from "~/components/ui/alert";
import { SectionCard } from "~/components/ui/section-card";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { UploadSection } from "~/components/import/upload-section";
import {
  DISCARD_UPLOAD_HINT,
  IMPORT_BLOCKED_BY_ERRORS,
  IMPORT_BLOCKED_NOTHING_TO_IMPORT,
  TEMPLATE_DOWNLOAD_HINT,
} from "~/components/import/import-hints";
import { StatsCards } from "~/components/import/stats-cards";
import { StudentRowCard } from "~/components/import/student-row-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import {
  IMPORT_MODE_HINTS,
  IMPORT_MODE_ITEMS,
  type ImportMode,
} from "~/lib/import-mode";
import {
  countAlreadyExistsRows,
  importBatchFailureMessage,
  importBatchSavedCount,
  readImportBatchFailure,
  readImportBatchRejection,
} from "~/lib/import-batch-result";
import { importChildQuotaNotice } from "~/lib/child-quota-import";
import { childQuotaMessage } from "~/lib/child-quota-error";
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
import type * as importContract from "~/lib/contract/import.generated";
import { createLogger } from "~/lib/logger";

/** Info-Knopf am Seitentitel: wofür die Seite da ist und was man zuerst tut. */
const STUDENTS_IMPORT_INFO =
  "Hier legst du viele Kinder auf einmal aus einer Datei an. Lade zuerst die Vorlage herunter und fülle sie aus.";

const logger = createLogger({ component: "StudentImportPage" });

// Status types for display
type RowStatus = "new" | "existing" | "error" | "warning";

interface DisplayStudent {
  row: number;
  status: RowStatus;
  errors: string[];
  notes: string[];
  firstName: string;
  lastName: string;
  schoolClass: string;
  groupName: string;
  guardianInfo: string;
  healthInfo: string;
}

function childCountLabel(count: number): string {
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

/** Blocking and warning messages in red; plain hints stay gray. */
function splitMessages(
  findings: readonly importContract.ValidationError[] | null,
): {
  errors: string[];
  notes: string[];
} {
  const errors = findings ?? [];
  return {
    errors: errors.filter((e) => e.severity !== "info").map((e) => e.message),
    notes: errors.filter((e) => e.severity === "info").map((e) => e.message),
  };
}

function toDisplayStudent(
  row: importContract.StudentImportError,
): DisplayStudent {
  return {
    row: row.row_number,
    status: (row.errors ?? []).some(
      (error) =>
        error.code === "already_exists" || error.code === "will_update",
    )
      ? "existing"
      : (row.errors ?? []).some((error) => error.severity === "error")
        ? "error"
        : (row.errors ?? []).some((error) => error.severity === "warning")
          ? "warning"
          : "new",
    ...splitMessages(row.errors),
    firstName: row.data.first_name,
    lastName: row.data.last_name,
    schoolClass: row.data.school_class,
    groupName: row.data.group_name ?? "",
    guardianInfo: guardianLabel(row.data.guardians),
    healthInfo: row.data.health_info ?? "",
  };
}

/** "Maria Muster (Mutter)" from whatever parts the row carries; empty when none. */
function guardianLabel(
  guardians: importContract.StudentImportError["data"]["guardians"] | undefined,
): string {
  const first = guardians?.[0];
  if (!first) return "";
  const name = [first.first_name, first.last_name]
    .filter((part) => part && part.trim() !== "")
    .join(" ");
  const relation = first.relationship_type?.trim() ?? "";
  if (name && relation) return `${name} (${relation})`;
  return name || relation || first.email || "";
}

export default function StudentImportPage() {
  const previewGeneration = useRef(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<DisplayStudent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importInterrupted, setImportInterrupted] = useState(false);
  const [importResult, setImportResult] =
    useState<importContract.StudentPreviewResponse | null>(null);
  // Fehler der Datei und des Imports stehen im Kasten über der Vorlage,
  // mit Wiederholen (#2517). Ein angehaltener Stapel steht dort auch, mit
  // oder ohne gespeicherte Zeilen: der Import als Ganzes ist gescheitert.
  const importErrors = useApiFormError();
  const { show: showTemplateError } = useApiErrorDisplay();
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const latestImportRef = useRef<() => void>(() => undefined);
  const [templateFormat, setTemplateFormat] = useState<"csv" | "xlsx">("xlsx");
  const [mode, setMode] = useState<ImportMode>("create");

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  const toast = useToast();

  // Reset form to initial state
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

  // Handle template download from backend
  const handleDownloadTemplate = async () => {
    try {
      await downloadImportTemplate(
        "GET /api/import/students/template",
        templateFormat,
        templateFormat === "xlsx"
          ? "schueler-import-vorlage.xlsx"
          : "schueler-import-vorlage.csv",
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

  // Handle file upload and preview via backend API
  const handleFileUpload = useCallback(
    async (file: File, importMode: ImportMode = mode) => {
      const generation = ++previewGeneration.current;
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
        formData.append("mode", importMode);

        const importData: importContract.StudentPreviewResponse = await bffJson(
          "tenant",
          "POST /api/import/students/preview",
          { body: formData, errorMessage: "Student import preview failed" },
        );
        const displayData: DisplayStudent[] = [];

        // Process errors (rows with issues)
        if (importData.errors) {
          for (const row of importData.errors) {
            const hasErrors = (row.errors ?? []).some(
              (e) => e.severity === "error",
            );
            const hasWarnings = (row.errors ?? []).some(
              (e) => e.severity === "warning",
            );
            const isExisting = (row.errors ?? []).some(
              (e) => e.code === "already_exists" || e.code === "will_update",
            );

            // Determine row status based on error conditions
            // Check isExisting first because already_exists has severity "error"
            const getRowStatus = ():
              "error" | "existing" | "warning" | "new" => {
              if (isExisting) return "existing";
              if (hasErrors) return "error";
              if (hasWarnings) return "warning";
              return "new";
            };

            displayData.push({
              row: row.row_number,
              status: getRowStatus(),
              ...splitMessages(row.errors),
              firstName: row.data.first_name,
              lastName: row.data.last_name,
              schoolClass: row.data.school_class,
              groupName: row.data.group_name ?? "",
              guardianInfo: guardianLabel(row.data.guardians),
              healthInfo: row.data.health_info ?? "",
            });
          }
        }

        // Calculate how many are new (total - errors)
        const newCount = importData.total_rows - displayData.length;

        // Add placeholder entries for successful rows (they're not in Errors array)
        // Note: In a real implementation, we'd want the backend to return all rows
        if (newCount > 0 && displayData.length === 0) {
          // If no errors, create a summary
          displayData.push({
            row: 0,
            status: "new",
            errors: [],
            notes: [],
            firstName: `${importData.total_rows} Kinder`,
            // Passt die Datei nicht ins Kinderkontingent, ist nichts bereit.
            lastName:
              importData.child_quota?.fits === false
                ? "neu in der Datei"
                : "bereit zum Import",
            schoolClass: "",
            groupName: "",
            guardianInfo: "",
            healthInfo: "",
          });
        }

        if (generation !== previewGeneration.current) return;
        setPreviewData(displayData);
        setImportResult(importData);
      } catch (err) {
        logger.error("student_preview_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (generation !== previewGeneration.current) return;
        void importErrors.show(err, {
          object: "die Datei",
          retry: () => void handleFileUpload(file, importMode),
        });
        setPreviewData([]);
      } finally {
        if (generation === previewGeneration.current) setIsLoading(false);
      }
    },
    [mode, importErrors],
  );

  // A new mode changes what the preview means, so the uploaded file is
  // checked again right away.
  const handleModeChange = (next: ImportMode) => {
    setMode(next);
    if (uploadedFile) {
      setPreviewData([]);
      void handleFileUpload(uploadedFile, next);
    }
  };

  // Handle actual import
  const handleImport = async () => {
    if (!uploadedFile || isLoading) return;

    setIsImporting(true);
    importErrors.clear();
    setBatchNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("mode", mode);

      let importData: importContract.StudentPreviewResponse;
      try {
        importData = await bffJson(
          "tenant",
          "POST /api/import/students/import",
          { body: formData, errorMessage: "Student import failed" },
        );
      } catch (error) {
        // A stopped batch carries the rows already saved in its error body.
        const result = importFailureBody(error);
        const interrupted =
          readImportBatchFailure<importContract.StudentImportError>(result);
        if (interrupted) {
          setImportResult(interrupted as importContract.StudentPreviewResponse);
          setImportInterrupted(true);
          setPreviewData((interrupted.errors ?? []).map(toDisplayStudent));
          // Ein Stapel kann am Kinderkontingent scheitern, wenn zwischen
          // Vorschau und Start andere Kinder dazukamen.
          setBatchNotice(
            importBatchFailureMessage(
              interrupted,
              childQuotaMessage(readImportBatchRejection(result)),
            ),
          );
          logger.error("student_import_batch_failed", {
            created: interrupted.created_count,
            updated: interrupted.updated_count,
            errors: interrupted.error_count,
          });
          return;
        }
        // Das Kinderkontingent lehnt den ganzen Import ab, bevor er startet:
        // Zwischen Vorschau und Start kamen andere Kinder dazu. Die Vorschau
        // wird neu geprüft; ihr Hinweis nennt dann den aktuellen Stand und
        // sperrt den Knopf.
        if (childQuotaMessage(result)) {
          await handleFileUpload(uploadedFile);
          return;
        }
        throw error;
      }
      setImportResult(importData);
      setImportInterrupted(false);

      // Handle partial failures vs full success
      if (importData.error_count > 0) {
        // Partial success: Show warning and keep form to display error details
        // Don't set importComplete - keep preview visible so user sees which rows failed
        setPreviewData((importData.errors ?? []).map(toDisplayStudent));
        toast.warning(
          `Der Import ist fertig: ${childCountLabel(importData.created_count)} importiert, ${importData.updated_count} aktualisiert, ${importData.error_count} übersprungen.`,
        );
      } else {
        // Full success: Mark complete, show success toast and reset form for next import
        setImportComplete(true);
        toast.success(
          `Der Import ist fertig: ${childCountLabel(importData.created_count)} importiert, ${importData.updated_count} aktualisiert.`,
        );
        resetForm();
      }
    } catch (err) {
      logger.error("student_import_failed", {
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

  // already_exists is a skip, not a blocking preview error. Create-mode
  // recovery re-uploads count committed rows that way; they must not disable Import.
  const alreadyExists = countAlreadyExistsRows(importResult?.errors);
  const stats = {
    total: importResult?.total_rows ?? 0,
    new: importResult?.created_count ?? 0,
    existing: (importResult?.updated_count ?? 0) + alreadyExists,
    errors: (importResult?.error_count ?? 0) - alreadyExists,
  };
  const importable =
    mode === "update"
      ? (importResult?.updated_count ?? 0)
      : stats.new +
        (mode === "upsert" ? (importResult?.updated_count ?? 0) : 0);
  const importLabel = importInterrupted
    ? "Erneut versuchen"
    : mode === "create"
      ? `${childCountLabel(stats.new)} importieren`
      : mode === "update"
        ? `${childCountLabel(importable)} aktualisieren`
        : `${childCountLabel(importable)} übernehmen`;
  const savedCount = importResult ? importBatchSavedCount(importResult) : 0;
  // Passen die neuen Kinder nicht ins Kinderkontingent, startet der Import
  // gar nicht (ganz oder gar nicht).
  const quotaNotice = importInterrupted
    ? null
    : importChildQuotaNotice(importResult?.child_quota);
  // Passt die Datei nicht ins Kontingent, steht das im Fehlerkasten.
  const quotaBlocker =
    quotaNotice?.type === "error" ? quotaNotice.message : null;

  // Statuszeile des Seitenkopfs: der Stand des Imports, nicht ein Erklärsatz.
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

  if (status === "loading") {
    return (
      <TenantPage
        title="Kinder importieren"
        info={STUDENTS_IMPORT_INFO}
        stats={statusLine}
        back
        backHref="/database/students"
        backLabel="Zurück zu den Kinderdaten"
      >
        <SkeletonRegion label="Kinder-Import wird geladen…">
          <FormSkeleton fields={2} />
        </SkeletonRegion>
      </TenantPage>
    );
  }

  return (
    <TenantPage
      title="Kinder importieren"
      info={STUDENTS_IMPORT_INFO}
      stats={statusLine}
      back
      backHref="/database/students"
      backLabel="Zurück zu den Kinderdaten"
    >
      {/* Info Section */}
      <SectionCard title="Import-Anleitung" icon={Info}>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>Lade die Vorlage herunter (siehe unten)</li>
          <li>Fülle die Datei mit deinen Kinderdaten aus</li>
          <li>
            Für Geburtstage sind diese Formate erlaubt: JJJJ-MM-TT, TT.MM.JJJJ
            oder TT.MM.JJ
          </li>
          <li>
            Die Vorlage enthält auch Adresse, RFID-Karte und bis zu vier
            Erziehungsberechtigte. Das Blatt „Hinweise“ erklärt jede Spalte
          </li>
          <li>Speichere die ausgefüllte Datei</li>
          <li>Lade die Datei hier hoch und überprüfe die Vorschau</li>
          <li>Bestätige den Import</li>
        </ul>
      </SectionCard>

      <FormErrorAlert
        message={importErrors.error ?? batchNotice ?? quotaBlocker}
      />

      {/* Download Template Button */}
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
          Beispiel Geburtstag: <span className="font-medium">2015-08-15</span>,{" "}
          <span className="font-medium">15.08.2015</span> oder{" "}
          <span className="font-medium">15.08.15</span>
        </p>
      </SectionCard>

      <SectionCard title="Was soll der Import tun?" icon={RefreshCw}>
        <SegmentedControl
          items={IMPORT_MODE_ITEMS}
          value={mode}
          onChange={handleModeChange}
          fullWidth
          ariaLabel="Import-Modus"
        />
        <p className="mt-3 text-sm text-gray-600">{IMPORT_MODE_HINTS[mode]}</p>
        <p className="mt-1 text-sm text-gray-500">
          Bekannt ist eine Zeile über Vorname, Nachname und Klasse. Bei
          Klassenwechsel über die RFID-Karte oder den Geburtstag.
        </p>
      </SectionCard>

      {/* Upload Section */}
      <div data-setup-tour="student-import-upload">
        <UploadSection
          title="Schritt 3: Datei hochladen"
          isLoading={isLoading}
          uploadedFile={uploadedFile}
          onFileSelect={handleFileChosen}
        />
      </div>

      {/* Preview Section */}
      {(previewData.length > 0 || importInterrupted) && !importComplete && (
        <>
          {quotaNotice?.type === "info" && (
            <Alert type="info" message={quotaNotice.message} />
          )}

          {/* Statistics */}
          <StatsCards
            total={stats.total}
            newCount={stats.new}
            existing={stats.existing}
            existingTitle={
              mode === "create" ? "Vorhanden" : "Wird aktualisiert"
            }
            errors={stats.errors}
          />

          {previewData.length > 0 && (
            <SectionCard title="Datenvorschau" icon={ListChecks}>
              <div className="space-y-2">
                {previewData.map((student, idx) => (
                  <StudentRowCard
                    key={student.row}
                    student={{
                      row: student.row,
                      status: student.status,
                      errors: student.errors,
                      notes: student.notes,
                      firstName: student.firstName,
                      lastName: student.lastName,
                      meta: [
                        student.schoolClass,
                        student.groupName,
                        student.guardianInfo,
                      ],
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
              data-setup-tour="student-import-submit"
              disabled={
                isImporting ||
                isLoading ||
                (!importInterrupted &&
                  (stats.errors > 0 ||
                    importable === 0 ||
                    quotaNotice?.type === "error"))
              }
              disabledReason={
                isImporting || isLoading
                  ? undefined
                  : stats.errors > 0
                    ? IMPORT_BLOCKED_BY_ERRORS
                    : quotaNotice?.type === "error"
                      ? "Nimm zuerst Kinder aus der Datei, bis die freien Plätze reichen."
                      : IMPORT_BLOCKED_NOTHING_TO_IMPORT
              }
              tooltip={
                mode === "create"
                  ? "Legt die neuen Kinder aus der Datei an."
                  : mode === "update"
                    ? "Ändert die vorhandenen Kinder nach der Datei."
                    : "Legt neue Kinder an und ändert vorhandene nach der Datei."
              }
              onClick={() => void handleImport()}
            >
              {isImporting ? "Wird importiert…" : importLabel}
            </Button>
          </StickyActionBar>
        </>
      )}
    </TenantPage>
  );
}
