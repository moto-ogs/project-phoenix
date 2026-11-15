"use client";

// Berichte nach Vorlage (#4716, Spec #4611 Stories 115 und 116): die Zahlen
// aller Schulen des Trägers an einem Stichtag, für Jugendamt und Kommune.
// Oben Vorlage und Stichtag, darunter Kennzahlen und je Abschnitt eine
// Tabelle, je Schule oder je Sozialraum, mit einer Zeile „Gesamt“. Der
// zweite Reiter verwaltet die Vorlagen des Trägers. Nur Zahlen, keine Namen;
// der Export enthält dieselben Zahlen als PDF, Excel oder CSV.

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Copy, FileText, Pencil, School, Trash2 } from "lucide-react";
import {
  absenceColumns,
  careFormSubRows,
  childrenColumns,
  demandColumns,
  staffColumns,
} from "~/components/traeger/key-date-report-tables";
import {
  demandGap,
  formatCount,
  formatPercent,
  formatRatio,
  keyDateInYear,
  lateAttendanceStart,
  latestKeyDate,
  placeShare,
  reportRows,
  SECTION_META,
  shiftDate,
  templateSummary,
  totalRow,
  type ReportGrouping,
  type ReportRow,
} from "~/components/traeger/key-date-report-model";
import { useReportTemplates } from "~/components/traeger/use-report-templates";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EmptyState } from "~/components/ui/empty-state";
import {
  ExportMenu,
  type ExportMenuOption,
  exportFormatOptions,
} from "~/components/ui/export-menu";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  useApiErrorDisplay,
  useApiFormError,
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { hasPermission } from "~/lib/auth-utils";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { childrenConcept } from "~/lib/concepts/children";
import { staffConcept } from "~/lib/concepts/staff";
import { utilizationConcept } from "~/lib/concepts/utilization";
import { formatDate, parseISODate } from "~/lib/date-helpers";
import { downloadBlob } from "~/lib/file-download";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  deleteReportTemplate,
  downloadKeyDateReport,
  fetchKeyDateReport,
  REPORT_TEMPLATES_MANAGE_RIGHT,
  type KeyDateReport,
  type ReportExportFormat,
  type ReportSection,
  type ReportTemplate,
} from "~/lib/traeger-reports-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerReportsPage" });

const EXPORT_FORMATS: readonly ExportMenuOption[] = exportFormatOptions([
  "pdf",
  "xlsx",
  "csv",
]);

/** Ohne Vorlage: alle Abschnitte, keine Sozialräume. */
const STANDARD = "standard";
/** `?vorlage=ID&stichtag=YYYY-MM-DD` öffnet einen Bericht direkt. */
const TEMPLATE_PARAM = "vorlage";
const KEY_DATE_PARAM = "stichtag";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Tab = "bericht" | "vorlagen";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "bericht", label: "Bericht" },
  { value: "vorlagen", label: "Vorlagen" },
];

const GROUPINGS: readonly { value: ReportGrouping; label: string }[] = [
  { value: "schools", label: "Je Schule" },
  { value: "districts", label: "Je Sozialraum" },
];

/** Statische Spaltenklassen, damit Tailwind sie findet. */
const FIGURE_GRID: Record<number, string> = {
  1: "grid gap-4 max-sm:gap-3 sm:grid-cols-2",
  2: "grid gap-4 max-sm:gap-3 sm:grid-cols-2",
  3: "grid gap-4 max-sm:gap-3 sm:grid-cols-3",
  4: "grid gap-4 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-4",
  5: "grid gap-4 max-sm:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
};

/** Die Kennzahlen über den Tabellen, nur für die Abschnitte des Berichts. */
function Figures({ report }: Readonly<{ report: KeyDateReport }>) {
  const total = report.total.figures;
  const has = (section: ReportSection) => report.sections.includes(section);
  const share = placeShare(total);
  const gap = demandGap(total);
  const cards = [
    has("children") ? (
      <StatCard
        key="children"
        label="Kinder am Stichtag"
        value={formatCount(total.children)}
        hint={
          total.withoutCareForm > 0
            ? `davon ${formatCount(total.withoutCareForm)} ohne Betreuungsform`
            : "alle mit Betreuungsform"
        }
        tone="green"
        icon={<MotoConceptIcon concept={childrenConcept} />}
      />
    ) : null,
    has("demand") ? (
      <StatCard
        key="places"
        label="Plätze belegt"
        value={share === null ? "–" : formatPercent(share * 100)}
        hint={
          share === null
            ? "Keine Betreuungsform mit Platzgrenze"
            : `${formatCount(total.bookedPlaces)} von ${formatCount(total.places)} Plätzen`
        }
        progressPct={share === null ? undefined : Math.min(share, 1) * 100}
        tone={share !== null && share >= 1 ? "orange" : "green"}
        icon={<MotoConceptIcon concept={utilizationConcept} />}
      />
    ) : null,
    has("demand") ? (
      <StatCard
        key="demand"
        label="Nachfrage"
        value={formatCount(total.demand)}
        hint={
          gap === null
            ? `${formatCount(total.open)} offen · ${formatCount(total.waitlisted)} auf der Warteliste`
            : gap > 0
              ? `${formatCount(gap)} Plätze fehlen`
              : `${formatCount(-gap)} Plätze bleiben frei`
        }
        tone={gap !== null && gap > 0 ? "orange" : "blue"}
        icon={<MotoConceptIcon concept={carePlanConcept} />}
      />
    ) : null,
    has("staff") ? (
      <StatCard
        key="staff"
        label="Personal"
        value={formatCount(total.staff)}
        hint={
          total.childrenPerStaff === null
            ? "Kein Personal am Stichtag"
            : `${formatRatio(total.childrenPerStaff)} Kinder je Person`
        }
        tone="orange"
        icon={<MotoConceptIcon concept={staffConcept} />}
      />
    ) : null,
    has("absences") ? (
      <StatCard
        key="absences"
        label="Fehlquote"
        value={formatPercent(total.absenceRate)}
        hint={`${formatCount(total.sickDays)} krank · ${formatCount(total.excusedDays)} entschuldigt`}
        tone="neutral"
      />
    ) : null,
  ].filter((card) => card !== null);
  return (
    <div className={FIGURE_GRID[cards.length] ?? FIGURE_GRID[4]}>{cards}</div>
  );
}

/** Ein Hinweis, wenn Check-ins einer Schule erst im Zeitraum der Fehlzeiten beginnen. */
function AttendanceNotice({ report }: Readonly<{ report: KeyDateReport }>) {
  const late = lateAttendanceStart(report);
  if (!late.first) return null;
  const message =
    late.schools > 1
      ? `Bei ${late.schools} Schulen beginnen die Check-ins erst nach dem Schuljahresbeginn. Für die Tage davor zählt moto keine Anwesenheit.`
      : `Bei einer Schule gibt es Check-ins erst ab ${formatDate(late.first)}. Für die Tage davor zählt moto keine Anwesenheit.`;
  return <Alert type="info" message={message} />;
}

function SectionTable({
  title,
  columns,
  rows,
  expandable,
}: Readonly<{
  title: string;
  columns: DataTableColumn<ReportRow>[];
  rows: ReportRow[];
  expandable?: boolean;
}>) {
  return (
    <DataTable
      heading={{ title, level: 2 }}
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.key}
      rowTone={(row) => (row.key === "total" ? "muted" : null)}
      expandable={
        expandable
          ? {
              canExpand: (row) => row.careForms.length > 0,
              rowLabel: (row, expanded) =>
                `${row.name}: Betreuungsformen ${expanded ? "zuklappen" : "aufklappen"}`,
            }
          : undefined
      }
      renderSubRows={
        expandable
          ? (row, expanded) => (expanded ? careFormSubRows(row) : [])
          : undefined
      }
      stackedOnMobile
    />
  );
}

/** Der Inhalt des Reiters „Bericht“. */
function ReportBody({
  report,
  grouping,
}: Readonly<{ report: KeyDateReport; grouping: ReportGrouping }>) {
  const byDistrict = grouping === "districts" && report.districts.length > 0;
  const header = byDistrict ? "Sozialraum" : "Schule";
  const rows = useMemo(
    () => [...reportRows(report, grouping), totalRow(report)],
    [report, grouping],
  );
  const has = (section: ReportSection) => report.sections.includes(section);
  const window = report.absenceWindow;
  return (
    <>
      <Figures report={report} />
      {has("children") ? (
        <SectionTable
          title={SECTION_META.children.label}
          columns={childrenColumns(header)}
          rows={rows}
          expandable
        />
      ) : null}
      {has("demand") ? (
        <SectionTable
          title={SECTION_META.demand.label}
          columns={demandColumns(header)}
          rows={rows}
        />
      ) : null}
      {has("staff") ? (
        <SectionTable
          title={SECTION_META.staff.label}
          columns={staffColumns(header)}
          rows={rows}
        />
      ) : null}
      {has("absences") ? (
        <>
          <AttendanceNotice report={report} />
          <SectionTable
            title={
              window
                ? `${SECTION_META.absences.label} vom ${formatDate(window.from)} bis ${formatDate(window.to)}`
                : `${SECTION_META.absences.label} (noch kein Tag vor dem Stichtag)`
            }
            columns={absenceColumns(header)}
            rows={rows}
          />
        </>
      ) : null}
    </>
  );
}

/** Der Inhalt des Reiters „Vorlagen“. */
function TemplatesBody({
  templates,
  loading,
  canManage,
  onOpen,
  onDelete,
}: Readonly<{
  templates: readonly ReportTemplate[];
  loading: boolean;
  canManage: boolean;
  onOpen: (template: ReportTemplate) => void;
  onDelete: (template: ReportTemplate) => void;
}>) {
  const router = useRouter();
  const editHref = (template: ReportTemplate) =>
    traegerPath(`/traeger/berichte/vorlagen/${template.id}`);
  const columns: DataTableColumn<ReportTemplate>[] = [
    {
      key: "name",
      header: "Vorlage",
      stacked: "title",
      sortValue: (template) => template.name,
      render: (template) => (
        <div className="min-w-0">
          <span className="block font-medium text-gray-900">
            {template.name}
          </span>
          <span className="block text-xs text-gray-500">
            {templateSummary(template)}
          </span>
        </div>
      ),
    },
    {
      key: "sections",
      header: "Abschnitte",
      render: (template) => (
        <span className="flex flex-wrap gap-1.5">
          {template.sections.map((section) => (
            <StatusBadge
              key={section}
              tone="gray"
              size="xs"
              label={SECTION_META[section].label}
            />
          ))}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Geändert",
      align: "right",
      stacked: "meta",
      sortValue: (template) => template.updatedAt,
      render: (template) => (
        <span className="text-sm whitespace-nowrap text-gray-500">
          {template.updatedAt ? formatDate(template.updatedAt) : "–"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Aktionen",
      headerSrOnly: true,
      render: (template) => (
        <OverflowMenu
          ariaLabel={`Aktionen für ${template.name}`}
          items={[
            {
              icon: <FileText className="size-4" aria-hidden />,
              label: "Bericht zeigen",
              description: "Zeigt den Bericht mit dieser Vorlage.",
              onClick: () => onOpen(template),
            },
            ...(canManage
              ? [
                  {
                    icon: <Pencil className="size-4" aria-hidden />,
                    label: "Ändern",
                    description: "Öffnet die Vorlage zum Ändern.",
                    onClick: () => router.push(editHref(template)),
                  },
                  {
                    icon: <Copy className="size-4" aria-hidden />,
                    label: "Kopieren",
                    description:
                      "Legt eine neue Vorlage mit diesen Angaben an.",
                    onClick: () =>
                      router.push(
                        traegerPath(
                          `/traeger/berichte/vorlagen/neu?kopie=${encodeURIComponent(template.id)}`,
                        ),
                      ),
                  },
                  {
                    icon: <Trash2 className="size-4" aria-hidden />,
                    label: "Löschen",
                    description: "moto fragt vorher nach.",
                    destructive: true,
                    onClick: () => onDelete(template),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  return (
    <DataTable
      heading={{ title: "Vorlagen", count: templates.length, level: 2 }}
      columns={columns}
      rows={[...templates]}
      getRowKey={(template) => template.id}
      defaultSortKey="name"
      isLoading={loading}
      loadingRowCount={2}
      stackedOnMobile
      emptyState={
        <EmptyState
          title="Noch keine Vorlage"
          description={
            canManage
              ? "Eine Vorlage merkt sich Abschnitte, Stichtag und Sozialräume. Legen Sie oben mit „Neue Vorlage“ die erste an."
              : "Eine Vorlage merkt sich Abschnitte, Stichtag und Sozialräume. Vorlagen legt die Verwaltung des Trägers an."
          }
        />
      }
    />
  );
}

export default function TraegerReportsPage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense fallback={<TenantPage title="Berichte" loading />}>
      <TraegerReportsContent />
    </Suspense>
  );
}

function TraegerReportsContent() {
  const { data: session, status } = useSession();
  const canManage = hasPermission(
    session ?? null,
    REPORT_TEMPLATES_MANAGE_RIGHT,
  );
  const orgId = session?.user?.orgId;
  const params = useSearchParams();
  const today = useBerlinToday();
  const [tab, setTab] = useState<Tab>("bericht");
  const [templateId, setTemplateId] = useState<string>(
    () => params.get(TEMPLATE_PARAM) ?? STANDARD,
  );
  const [keyDate, setKeyDate] = useState<string | null>(() => {
    const value = params.get(KEY_DATE_PARAM);
    return value && ISO_DATE.test(value) ? value : null;
  });
  const [grouping, setGrouping] = useState<ReportGrouping>("schools");
  const [report, setReport] = useState<KeyDateReport | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReportTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const request = useRef(0);
  const pageLoad = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = pageLoad;
  const { show: showActionError } = useApiErrorDisplay();
  const deleteErrors = useApiFormError();
  const { success } = useToast();

  const {
    templates: loadedTemplates,
    error: templatesError,
    mutate: mutateTemplates,
  } = useReportTemplates();
  const templates = useMemo(() => loadedTemplates ?? [], [loadedTemplates]);
  const template =
    templateId === STANDARD
      ? null
      : (templates.find((entry) => entry.id === templateId) ?? null);
  // Ohne gewählten Tag gilt der übliche Stichtag der Vorlage, sonst der 15.10.
  const defaultKeyDate = latestKeyDate(
    today,
    template?.keyDateMonth,
    template?.keyDateDay,
  );
  const shownKeyDate = keyDate ?? defaultKeyDate;
  // Eine Vorlage, die es nicht (mehr) gibt, fällt auf den Standard zurück.
  const templateKnown = templateId === STANDARD || loadedTemplates !== null;
  const effectiveTemplate =
    templateId !== STANDARD && loadedTemplates !== null && !template
      ? STANDARD
      : templateId;

  const load = useCallback(async () => {
    if (orgId === undefined || !templateKnown) return;
    const current = ++request.current;
    setReport(null);
    try {
      const result = await fetchKeyDateReport(
        shownKeyDate,
        effectiveTemplate === STANDARD ? null : effectiveTemplate,
      );
      if (current !== request.current) return;
      setReport(result);
      clearLoadError();
    } catch (err) {
      if (current !== request.current) return;
      logger.error("traeger_report_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showLoadError(err, {
        object: "der Bericht",
        retry: () => void load(),
      });
    }
  }, [
    orgId,
    templateKnown,
    shownKeyDate,
    effectiveTemplate,
    clearLoadError,
    showLoadError,
  ]);

  // A switch of the Träger drops what the previous one showed.
  const shownOrgId = useRef(orgId);
  useEffect(() => {
    if (shownOrgId.current === orgId) return;
    shownOrgId.current = orgId;
    request.current++;
    setReport(null);
    setTemplateId(STANDARD);
  }, [orgId]);

  useEffect(() => {
    if (status === "loading") return;
    void load();
  }, [load, status]);

  useEffect(() => {
    if (report && report.districts.length === 0) setGrouping("schools");
  }, [report]);

  async function exportReport(option: ExportMenuOption) {
    const format = option.format as ReportExportFormat | undefined;
    if (!format) return;
    setExporting(option.key);
    try {
      const file = await downloadKeyDateReport(
        shownKeyDate,
        effectiveTemplate === STANDARD ? null : effectiveTemplate,
        format,
      );
      downloadBlob(
        file.blob,
        file.filename ?? `bericht-stichtag-${shownKeyDate}.${format}`,
      );
    } catch (err) {
      logger.error("traeger_report_export_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, { object: "die Exportdatei" });
    } finally {
      setExporting(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    deleteErrors.clear();
    try {
      await deleteReportTemplate(deleting.id);
      if (templateId === deleting.id) setTemplateId(STANDARD);
      await mutateTemplates();
      success(`Die Vorlage „${deleting.name}“ ist gelöscht.`);
      setDeleting(null);
    } catch (err) {
      logger.error("traeger_report_template_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "die Vorlage" });
    } finally {
      setDeleteBusy(false);
    }
  }

  const changeTemplate = (next: string) => {
    setTemplateId(next);
    // Der Stichtag folgt der Vorlage, bis jemand selbst einen Tag wählt.
    setKeyDate(null);
  };

  const loading = report === null && !pageLoad.error;
  const keyYear = parseISODate(shownKeyDate).getFullYear();
  const keyMonth = parseISODate(shownKeyDate).getMonth() + 1;
  const keyDay = parseISODate(shownKeyDate).getDate();
  const nextYearDate = keyDateInYear(keyYear + 1, keyMonth, keyDay);
  const maxDate = shiftDate(today, 366);
  const schoolCount = report?.schools.length ?? 0;

  const templateOptions = [
    { value: STANDARD, label: "Alle Abschnitte (ohne Vorlage)" },
    ...templates.map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  const onReportTab = tab === "bericht";

  return (
    <TenantPage
      title="Berichte"
      info={
        <>
          Hier erstellen Sie Berichte für Jugendamt und Kommune. moto zählt alle
          Schulen Ihres Trägers an einem Stichtag. Üblich ist der 15. Oktober.
          Eine Vorlage legt fest, welche Abschnitte der Bericht hat und welche
          Schule zu welchem Sozialraum gehört. Offene Anmeldungen und Warteliste
          zeigen immer den Stand von heute. Der Bericht enthält nur Zahlen,
          keine Namen.
        </>
      }
      actions={
        onReportTab ? (
          <ExportMenu
            ariaLabel="Bericht herunterladen"
            options={EXPORT_FORMATS}
            busyKey={exporting}
            unavailable={!report || schoolCount === 0}
            onSelect={(option) => void exportReport(option)}
          />
        ) : canManage ? (
          <ButtonLink
            href={traegerPath("/traeger/berichte/vorlagen/neu")}
            variant="primary"
            tooltip="Öffnet eine leere Vorlage zum Ausfüllen."
          >
            Neue Vorlage
          </ButtonLink>
        ) : null
      }
      stats={
        onReportTab && report ? (
          <TenantPageStats
            items={[
              { value: `Stichtag ${formatDate(report.keyDate)}`, label: "" },
              {
                value: schoolCount,
                label: schoolCount === 1 ? "Schule" : "Schulen",
              },
              ...(report.districts.length > 0
                ? [
                    {
                      value: report.districts.length,
                      label:
                        report.districts.length === 1
                          ? "Sozialraum"
                          : "Sozialräume",
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      statsLoading={onReportTab && loading}
      error={onReportTab ? pageLoad.error : templatesError}
      empty={
        onReportTab && report && schoolCount === 0
          ? {
              title: "Noch keine Schulen",
              description:
                "Sobald das moto-Team Ihrem Träger Schulen zuordnet, steht hier ihr Bericht.",
              icon: <School className="h-12 w-12" aria-hidden="true" />,
            }
          : null
      }
      searchSlot={
        onReportTab ? (
          <PlanningContextBar
            withoutContextRow
            navigationInGroup
            navigationSlot={
              <ISODatePicker
                id="report-key-date"
                ariaLabel="Stichtag"
                value={shownKeyDate}
                max={maxDate}
                min="2000-01-01"
                hideClearButton
                monthYearNavigation
                calendarLayout="popover"
                className="min-w-0"
                onChange={(next) => {
                  if (next) setKeyDate(next);
                }}
              />
            }
            onPrevious={() =>
              setKeyDate(keyDateInYear(keyYear - 1, keyMonth, keyDay))
            }
            onNext={
              nextYearDate <= maxDate
                ? () => setKeyDate(nextYearDate)
                : undefined
            }
            previousLabel="Ein Jahr davor"
            nextLabel="Ein Jahr danach"
            previousTooltip="Zeigt den Bericht zum selben Tag ein Jahr davor."
            nextTooltip="Zeigt den Bericht zum selben Tag ein Jahr danach."
            onToday={
              shownKeyDate === defaultKeyDate
                ? undefined
                : () => setKeyDate(null)
            }
            todayLabel="Üblicher Stichtag"
            actions={
              <div className="flex min-w-0 flex-wrap items-center gap-3 max-md:w-full max-md:flex-col max-md:items-stretch">
                <CustomSelect
                  ariaLabel="Vorlage"
                  value={templateKnown ? effectiveTemplate : STANDARD}
                  onChange={changeTemplate}
                  options={templateOptions}
                  className="min-w-0 md:w-72"
                />
                {report && report.districts.length > 0 ? (
                  <SegmentedControl
                    ariaLabel="Gliederung des Berichts"
                    items={GROUPINGS}
                    value={grouping}
                    onChange={setGrouping}
                  />
                ) : null}
              </div>
            }
          />
        ) : undefined
      }
      tabs={{
        value: tab,
        onChange: (next) => setTab(next as Tab),
        items: TABS,
        label: "Bereich der Berichte",
      }}
      overlays={
        <ConfirmDeleteModal
          isOpen={deleting !== null}
          onClose={() => {
            setDeleting(null);
            deleteErrors.clear();
          }}
          onConfirm={() => void confirmDelete()}
          title="Vorlage löschen?"
          description={
            <>
              <span className="font-medium">{deleting?.name}</span> steht danach
              nicht mehr zur Auswahl. Berichte, die Sie schon heruntergeladen
              haben, bleiben, wie sie sind.
            </>
          }
          confirmLabel="Löschen"
          loadingLabel="Wird gelöscht …"
          gate={{ mode: "twoStep", firstStepLabel: "Ja, löschen" }}
          loading={deleteBusy}
          error={deleteErrors.error}
        />
      }
    >
      {onReportTab ? (
        report ? (
          <ReportBody report={report} grouping={grouping} />
        ) : (
          <DataTable
            heading={{ title: SECTION_META.children.label, level: 2 }}
            columns={childrenColumns("Schule")}
            rows={[]}
            getRowKey={(row) => row.key}
            isLoading
            loadingRowCount={3}
            stackedOnMobile
          />
        )
      ) : (
        <TemplatesBody
          templates={templates}
          loading={loadedTemplates === null && !templatesError}
          canManage={canManage}
          onOpen={(entry) => {
            changeTemplate(entry.id);
            setTab("bericht");
          }}
          onDelete={setDeleting}
        />
      )}
    </TenantPage>
  );
}
