"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Download, Info, ListChecks, RefreshCw } from "lucide-react";
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
} from "~/lib/import-batch-result";
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
import { hasPermission } from "~/lib/auth-utils";
import { createCrudService } from "~/lib/database/service-factory";
import { rolesConfig } from "~/components/database/configs/roles.config";
import { getRoleDisplayName } from "~/lib/auth-helpers";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import * as importContract from "~/lib/contract/import.generated";
import { createLogger } from "~/lib/logger";

/** Info-Knopf am Seitentitel: wofür die Seite da ist und was man zuerst tut. */
const PERSONAL_IMPORT_INFO =
  "Hier übernimmst du viele Personen auf einmal aus einer Datei. Lade zuerst die Vorlage herunter und fülle sie aus.";

const logger = createLogger({ component: "StaffImportPage" });

type RowStatus = "new" | "existing" | "error" | "warning";

interface DisplayStaff {
  row: number;
  status: RowStatus;
  errors: string[];
  notes: string[];
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  position: string;
}

function rowStatusFor(
  findings: readonly importContract.ValidationError[] | null,
): RowStatus {
  const errors = findings ?? [];
  const isExisting = errors.some(
    (e) => e.code === "already_exists" || e.code === "will_update",
  );
  if (isExisting) return "existing";
  if (errors.some((e) => e.severity === "error")) return "error";
  if (errors.some((e) => e.severity === "warning")) return "warning";
  return "new";
}

function toDisplayStaff(row: importContract.StaffImportError): DisplayStaff {
  return {
    row: row.row_number,
    status: rowStatusFor(row.errors),
    errors: (row.errors ?? [])
      .filter((e) => e.severity !== "info")
      .map((e) => e.message),
    notes: (row.errors ?? [])
      .filter((e) => e.severity === "info")
      .map((e) => e.message),
    firstName: row.data.first_name,
    lastName: row.data.last_name,
    email: row.data.email ?? "",
    roleName: row.data.role_name,
    position: row.data.position ?? "",
  };
}

export default function StaffImportPage() {
  const previewGeneration = useRef(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<DisplayStaff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importInterrupted, setImportInterrupted] = useState(false);
  const [importResult, setImportResult] =
    useState<importContract.StaffImportResult | null>(null);
  // Fehler der Datei und des Imports stehen im Kasten über der Vorlage,
  // mit Wiederholen (#2517). Ein angehaltener Stapel steht dort auch, mit
  // oder ohne gespeicherte Zeilen: der Import als Ganzes ist gescheitert.
  const importErrors = useApiFormError();
  const { show: showTemplateError } = useApiErrorDisplay();
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const latestImportRef = useRef<() => void>(() => undefined);
  const [templateFormat, setTemplateFormat] = useState<"csv" | "xlsx">("xlsx");
  const [mode, setMode] = useState<ImportMode>("create");

  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  const toast = useToast();

  // Update and upsert mode write the same fields as the personnel screens,
  // so the backend refuses them without both personnel permissions (#2906).
  // Without them the page stays in create mode and says so.
  const canChangeExisting =
    hasPermission(session, "staff:manage") &&
    hasPermission(session, "staff:stammdaten");

  // Load the tenant's role names so the user knows what to put in the
  // "Rolle" column (the import matches role names exactly, case-insensitive).
  // The list endpoint accepts users:create, the permission this page opens
  // on, so the hint is complete for every user who may import (#2906).
  const rolesService = useMemo(() => createCrudService(rolesConfig), []);
  // Without the list the hint is missing; the import still works.
  const { data: roles } = useSWRAuth(tenantAdminKeys.roles(), async () => {
    const response = await rolesService.getList();
    return Array.isArray(response.data) ? response.data : [];
  });
  const availableRoles = useMemo(
    () =>
      (roles ?? [])
        .map((r) => getRoleDisplayName(r.name))
        .filter((name) => name !== ""),
    [roles],
  );

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
        "GET /api/import/teachers/template",
        templateFormat,
        templateFormat === "xlsx"
          ? "mitarbeiter-import-vorlage.xlsx"
          : "mitarbeiter-import-vorlage.csv",
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

        const importData: importContract.StaffImportResult = await bffJson(
          "tenant",
          "POST /api/import/teachers/preview",
          { body: formData, errorMessage: "Staff import preview failed" },
        );
        const displayData: DisplayStaff[] = (importData.errors ?? []).map(
          toDisplayStaff,
        );

        // Rows without issues are not in the Errors array — summarise them.
        const newCount = importData.total_rows - displayData.length;
        if (newCount > 0 && displayData.length === 0) {
          displayData.push({
            row: 0,
            status: "new",
            errors: [],
            notes: [],
            firstName: `${importData.total_rows} Mitarbeitende`,
            lastName: "bereit zum Import",
            email: "",
            roleName: "",
            position: "",
          });
        }

        if (generation !== previewGeneration.current) return;
        setPreviewData(displayData);
        setImportResult(importData);
      } catch (err) {
        logger.error("staff_preview_failed", {
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

  const handleImport = async () => {
    if (!uploadedFile || isLoading) return;

    setIsImporting(true);
    importErrors.clear();
    setBatchNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("mode", mode);

      let importData: importContract.StaffImportResult;
      try {
        importData = await bffJson(
          "tenant",
          "POST /api/import/teachers/import",
          { body: formData, errorMessage: "Staff import failed" },
        );
      } catch (error) {
        // A stopped batch carries the rows already saved in its error body.
        const result = importFailureBody(error);
        const interrupted = readImportBatchFailure(
          result,
          importContract.StaffImportResultSchema,
        );
        if (interrupted) {
          setImportResult(interrupted);
          setImportInterrupted(true);
          setPreviewData((interrupted.errors ?? []).map(toDisplayStaff));
          setBatchNotice(importBatchFailureMessage(interrupted));
          logger.error("staff_import_batch_failed", {
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
        // Partial success: keep preview visible so the user sees which rows failed.
        setPreviewData((importData.errors ?? []).map(toDisplayStaff));
        toast.warning(
          `Der Import ist fertig: ${importData.created_count} angelegt, ${importData.updated_count} aktualisiert, ${importData.error_count} übersprungen.`,
        );
      } else {
        setImportComplete(true);
        toast.success(
          `Der Import ist fertig: ${importData.created_count} angelegt, ${importData.updated_count} aktualisiert.`,
        );
        resetForm();
      }
    } catch (err) {
      logger.error("staff_import_failed", {
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
      ? `${stats.new} Mitarbeitende anlegen`
      : mode === "update"
        ? `${importable} Mitarbeitende aktualisieren`
        : `${importable} Mitarbeitende übernehmen`;
  const savedCount = importResult ? importBatchSavedCount(importResult) : 0;

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
        title="Personal importieren"
        info={PERSONAL_IMPORT_INFO}
        stats={statusLine}
        back
        backHref="/database/personal"
        backLabel="Zurück zum Personal"
      >
        <SkeletonRegion label="Import wird geladen…">
          <FormSkeleton fields={2} />
        </SkeletonRegion>
      </TenantPage>
    );
  }

  return (
    <TenantPage
      title="Personal importieren"
      info={PERSONAL_IMPORT_INFO}
      stats={statusLine}
      back
      backHref="/database/personal"
      backLabel="Zurück zum Personal"
    >
      {/* Info Section */}
      <SectionCard title="Import-Anleitung" icon={Info}>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>Lade die Vorlage herunter (siehe unten)</li>
          <li>Fülle die Datei mit den Daten deiner Mitarbeitenden aus</li>
          <li>
            Die Spalte „Rolle“ muss exakt einer vorhandenen Rolle entsprechen
            {availableRoles.length > 0 && (
              <>
                :{" "}
                {availableRoles.map((role, i) => (
                  <span key={role}>
                    {i > 0 && ", "}
                    <span className="font-medium text-gray-900">{role}</span>
                  </span>
                ))}
              </>
            )}
          </li>
          <li>
            Jede Zeile wird sofort in der Personalliste angelegt, mit Stammdaten
            wie Personalnummer, Adresse und Vertragsdaten
          </li>
          <li>
            Steht eine E-Mail in der Zeile, bekommt die Person zusätzlich eine
            Einladung und setzt ihr Passwort selbst. Ohne E-Mail gibt es keinen
            Zugang
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
          Pflicht: <span className="font-medium">Vorname</span>,{" "}
          <span className="font-medium">Nachname</span>,{" "}
          <span className="font-medium">Rolle</span>. Alle weiteren Spalten
          (E-Mail, Personalnummer, Adresse, Vertrag, Qualifikationen) sind
          optional und im Blatt „Hinweise“ erklärt
        </p>
      </SectionCard>

      <SectionCard title="Was soll der Import tun?" icon={RefreshCw}>
        {canChangeExisting ? (
          <>
            <SegmentedControl
              items={IMPORT_MODE_ITEMS}
              value={mode}
              onChange={handleModeChange}
              fullWidth
              ariaLabel="Import-Modus"
            />
            <p className="mt-3 text-sm text-gray-600">
              {IMPORT_MODE_HINTS[mode]}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Bekannt ist eine Zeile über Personalnummer, sonst E-Mail, sonst
              Vor- und Nachname.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Mit deinen Berechtigungen legt der Import nur neue Mitarbeitende an.
            Zeilen, die es schon gibt, werden als Fehler gemeldet. Bestehende
            Datensätze ändert die Leitung.
          </p>
        )}
      </SectionCard>

      {/* Upload Section */}
      <UploadSection
        title="Schritt 3: Datei hochladen"
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
            existingTitle={
              mode === "create" ? "Vorhanden" : "Wird aktualisiert"
            }
            errors={stats.errors}
          />

          {previewData.length > 0 && (
            <SectionCard title="Datenvorschau" icon={ListChecks}>
              <div className="space-y-2">
                {previewData.map((staff, idx) => (
                  <StudentRowCard
                    key={staff.row}
                    student={{
                      row: staff.row,
                      status: staff.status,
                      errors: staff.errors,
                      notes: staff.notes,
                      firstName: staff.firstName,
                      lastName: staff.lastName,
                      meta: [staff.email, staff.roleName, staff.position],
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
              disabled={
                isImporting ||
                isLoading ||
                (!importInterrupted && (stats.errors > 0 || importable === 0))
              }
              disabledReason={
                isImporting || isLoading
                  ? undefined
                  : stats.errors > 0
                    ? IMPORT_BLOCKED_BY_ERRORS
                    : IMPORT_BLOCKED_NOTHING_TO_IMPORT
              }
              tooltip={
                mode === "create"
                  ? "Legt die Personen an und schickt allen mit E-Mail eine Einladung."
                  : mode === "update"
                    ? "Ändert die vorhandenen Mitarbeitenden nach der Datei."
                    : "Ändert vorhandene Personen, legt neue an und schickt Neuen mit E-Mail eine Einladung."
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
