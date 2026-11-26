"use client";

// Die DATEV-Lohndatei des Trägers über alle Schulen (#4712, ADR 0250). Die
// Prüfung zeigt dieselbe Rechnung wie die Datei: Verträge je Art, Zeilen,
// Werte ohne Lohnart und Schulen mit offenem Monat. Was die Datei noch
// verhindert, steht als Liste mit dem nächsten Schritt darunter. In der Form
// je Arbeitgeber (#8041, ADR 0320) gibt es eine Datei je DATEV-Mandant, jede
// mit eigenem Download.

import { DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";

import { employerLabel } from "~/components/traeger/staff/payroll-employers-card";
import { CONTRACT_KIND_LABELS } from "~/components/traeger/staff/staff-contract-format";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { payrollConcept } from "~/lib/concepts/payroll";
import type { StaffContractKind } from "~/lib/traeger-staff-api";
import {
  PAYROLL_CATEGORY_LABELS,
  type PayrollFile,
  type PayrollFormat,
  type PayrollKindCount,
  type PayrollReport,
} from "~/lib/traeger-staff-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const FORMAT_ITEMS: readonly { value: PayrollFormat; label: string }[] = [
  { value: "datev_lodas", label: "LODAS" },
  { value: "datev_lug", label: "Lohn und Gehalt" },
];

/** Mehr offene Zeilen klappen ein (frontend-ui-kit, mehrere Hinweise). */
const VISIBLE_BLOCKERS = 5;

const kindLabel = (kind: string) =>
  CONTRACT_KIND_LABELS[kind as StaffContractKind] ?? kind;

const personName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`.trim();

interface Blocker {
  readonly key: string;
  readonly text: string;
  readonly action: ReactNode;
}

/** Die Arbeitgeber einer Datei: „Träger“, „Gemeinde Hardt“. */
const fileEmployers = (file: PayrollFile) =>
  file.employers
    .map((employer) =>
      employer.body === "traeger" ? "Träger" : employerLabel(employer),
    )
    .join(", ");

function openRecord(person: {
  recordId: string;
  firstName: string;
  lastName: string;
}) {
  return (
    <ButtonLink
      href={traegerPath(
        `/traeger/personal/${encodeURIComponent(person.recordId)}`,
      )}
      variant="surface"
      size="compact"
      aria-label={`Personalakte von ${personName(person)} öffnen`}
      tooltip="Öffnet die Personalakte, dort trägst du die Personalnummer ein."
    >
      Akte öffnen
    </ButtonLink>
  );
}

/** Was den Arbeitgebern und Dateien fehlt (#8041), je mit nächstem Schritt. */
function employerBlockers(
  report: PayrollReport,
  openSettings: (label: string) => ReactNode,
): Blocker[] {
  const blockers: Blocker[] = [];
  for (const employer of report.employers) {
    const name = `${employerLabel(employer)} (${employer.schoolName})`;
    if (employer.missingCostCenter) {
      blockers.push({
        key: `cost-center-${employer.schoolId}`,
        text: `Für ${name} fehlt die Kostenstelle.`,
        action: openSettings(
          `Einrichtung öffnen, um die Kostenstelle von ${name} einzutragen`,
        ),
      });
    }
    if (employer.missingClient) {
      blockers.push({
        key: `client-${employer.schoolId}`,
        text: `Für ${name} fehlen Berater- und Mandantennummer.`,
        action: openSettings(
          `Einrichtung öffnen, um die Nummern von ${name} einzutragen`,
        ),
      });
    }
  }
  if (report.form === "arbeitgeber") {
    for (const file of report.files) {
      if (
        file.missingClient &&
        file.employers.some((employer) => employer.body === "traeger")
      ) {
        blockers.push({
          key: `client-traeger-${file.key}`,
          text: "Für den Träger fehlen Berater- und Mandantennummer.",
          action: openSettings(
            "Einrichtung öffnen, um die Nummern des Trägers einzutragen",
          ),
        });
      }
    }
  }
  for (const file of report.files) {
    for (const split of file.splitNumbers) {
      blockers.push({
        key: `split-${file.key}-${split.person.recordId}`,
        text: `${personName(split.person)} stünde in der Datei für ${fileEmployers(file)} unter zwei Personalnummern (${split.numbers.join(" und ")}). Trag bei jedem Einsatzort dieses Arbeitgebers dieselbe Nummer ein.`,
        action: openRecord(split.person),
      });
    }
    for (const duplicate of file.duplicates) {
      const first = duplicate.people[0];
      blockers.push({
        key: `duplicate-${file.key}-${duplicate.number}`,
        text: `${duplicate.people.map(personName).join(" und ")} haben in der Datei für ${fileEmployers(file)} dieselbe Personalnummer ${duplicate.number}.`,
        action: first ? openRecord(first) : null,
      });
    }
  }
  return blockers;
}

/** Was die Datei noch verhindert, mit dem nächsten Schritt je Zeile. */
function blockersOf(
  report: PayrollReport,
  onOpenWageTypes: () => void,
): Blocker[] {
  const openWageTypes = (label: string) => (
    <Button
      type="button"
      variant="surface"
      size="compact"
      aria-label={label}
      tooltip="Öffnet die Einrichtung mit Lohnarten und DATEV-Nummern."
      onClick={onOpenWageTypes}
    >
      Einrichtung öffnen
    </Button>
  );
  const blockers: Blocker[] = [];
  if (report.noWageType) {
    blockers.push({
      key: "no-wage-type",
      text: "Es gibt noch keine Lohnart. Trage die Nummern aus deinem DATEV ein.",
      action: openWageTypes(
        "Einrichtung öffnen, um die erste Lohnart einzutragen",
      ),
    });
  }
  if (report.missingClient) {
    blockers.push({
      key: "missing-client",
      text: "Für LODAS fehlen die Beraternummer oder die Mandantennummer.",
      action: openWageTypes(
        "Einrichtung öffnen, um die Nummern für LODAS einzutragen",
      ),
    });
  }
  for (const person of report.withoutNumber) {
    blockers.push({
      key: `person-${person.recordId}`,
      text: `${personName(person)} hat noch keine Personalnummer.`,
      action: openRecord(person),
    });
  }
  return [...blockers, ...employerBlockers(report, openWageTypes)];
}

function BlockerList({
  blockers,
  perEmployer,
}: Readonly<{ blockers: readonly Blocker[]; perEmployer: boolean }>) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? blockers : blockers.slice(0, VISIBLE_BLOCKERS);
  const hidden = blockers.length - VISIBLE_BLOCKERS;
  return (
    <SectionCard
      leading={
        <WarningCircleIcon
          className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
      }
      title="Das fehlt noch"
      titleBadge={
        <StatusBadge
          label={`${blockers.length} offen`}
          tone="warning"
          compact
        />
      }
      description={
        perEmployer
          ? "Jede Datei entsteht, sobald für sie nichts mehr fehlt."
          : "Erst dann entsteht die Lohndatei."
      }
    >
      <ResponsiveActionList id="payroll-blockers">
        {shown.map((blocker) => (
          <ResponsiveActionRow key={blocker.key}>
            <p className="min-w-0 text-sm text-gray-800">{blocker.text}</p>
            <ResponsiveRowActions>{blocker.action}</ResponsiveRowActions>
          </ResponsiveActionRow>
        ))}
      </ResponsiveActionList>
      {hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="mt-2 w-full"
          aria-expanded={expanded}
          aria-controls="payroll-blockers"
          tooltip={
            expanded
              ? "Zeigt wieder nur die ersten Punkte."
              : "Zeigt alle offenen Punkte."
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <>
              Weniger anzeigen
              <ChevronUp className="size-4" aria-hidden="true" />
            </>
          ) : (
            <>
              {hidden} weitere anzeigen
              <ChevronDown className="size-4" aria-hidden="true" />
            </>
          )}
        </Button>
      ) : null}
    </SectionCard>
  );
}

/** Die Dateien der Form je Arbeitgeber, jede mit eigenem Download. */
function FileList({
  files,
  onDownloadFile,
  downloadingFile,
}: Readonly<{
  files: readonly PayrollFile[];
  onDownloadFile: (key: string) => void;
  downloadingFile: string | null;
}>) {
  return (
    <div>
      <SectionLabel as="h3" className="mb-2">
        Dateien pro Arbeitgeber
      </SectionLabel>
      <ResponsiveActionList>
        {files.map((file) => {
          const client =
            file.consultantNumber && file.clientNumber
              ? `Berater ${file.consultantNumber}, Mandant ${file.clientNumber}`
              : "Nummern fehlen";
          return (
            <ResponsiveActionRow key={file.key}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                  {fileEmployers(file)}
                  <StatusBadge
                    label={file.ready ? "Bereit" : "Noch nicht bereit"}
                    tone={file.ready ? "green" : "warning"}
                    compact
                  />
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {`${file.schools.join(", ")} · ${client} · ${file.people} ${file.people === 1 ? "Person" : "Personen"} · ${file.lineCount} Zeilen`}
                </p>
              </div>
              <ResponsiveRowActions>
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  className="gap-2"
                  aria-label={`Datei für ${fileEmployers(file)} herunterladen`}
                  disabled={!file.ready}
                  disabledReason={
                    file.ready
                      ? undefined
                      : "Erst muss für diese Datei alles unter „Das fehlt noch“ erledigt sein."
                  }
                  isLoading={downloadingFile === file.key}
                  loadingText="Lädt"
                  tooltip="Lädt die Datei dieses Arbeitgebers herunter. Das steht im Zugriffsprotokoll jeder Schule."
                  onClick={() => onDownloadFile(file.key)}
                >
                  <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
                  Herunterladen
                </Button>
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          );
        })}
      </ResponsiveActionList>
    </div>
  );
}

function kindColumns(
  report: PayrollReport,
): DataTableColumn<PayrollKindCount>[] {
  return [
    {
      key: "kind",
      header: "Art des Vertrags",
      stacked: "title",
      render: (row) => (
        <span className="font-medium text-gray-900">{kindLabel(row.kind)}</span>
      ),
    },
    {
      key: "contracts",
      header: "Verträge",
      align: "right",
      stacked: "field",
      render: (row) => (
        <span className="text-gray-700 tabular-nums">{row.contracts}</span>
      ),
    },
    {
      key: "lines",
      header: "Zeilen",
      align: "right",
      stacked: "field",
      render: (row) => (
        <span className="text-gray-700 tabular-nums">{row.lines}</span>
      ),
    },
    {
      key: "gaps",
      header: "Fehlt in der Datei",
      stacked: "field",
      render: (row) => {
        const gaps = report.unconfigured.filter((gap) => gap.kind === row.kind);
        if (gaps.length === 0) {
          return <StatusBadge label="Vollständig" tone="green" compact />;
        }
        return (
          <span className="flex flex-wrap gap-1.5">
            {gaps.map((gap) => (
              <StatusBadge
                key={gap.category}
                label={PAYROLL_CATEGORY_LABELS[gap.category]}
                tone="warning"
                compact
              />
            ))}
          </span>
        );
      },
    },
  ];
}

/** Der Stand der Karte; je Arbeitgeber kann ein Teil der Dateien fertig sein. */
function readinessLabel(report: PayrollReport): string {
  if (report.ready) return "Bereit";
  if (
    report.form === "arbeitgeber" &&
    report.files.some((file) => file.ready)
  ) {
    return "Teilweise bereit";
  }
  return "Noch nicht bereit";
}

/** Die Unterzeile der Karte: Monat und wie die Datei entsteht. */
function fileDescription(report: PayrollReport | null, monthLabel: string) {
  if (report?.form === "arbeitgeber") {
    return `${monthLabel} · Eine Datei pro Arbeitgeber, jede mit eigener Berater- und Mandantennummer.`;
  }
  if (report && report.employers.length > 0) {
    return `${monthLabel} · Eine Datei für alle Schulen. Stunden anderer Arbeitgeber tragen ihre Kostenstelle.`;
  }
  return `${monthLabel} · Eine Datei für alle Schulen. Jede Art des Vertrags hat eigene Lohnarten.`;
}

export function PayrollFilePanel({
  report,
  monthLabel,
  format,
  onFormatChange,
  onDownload,
  downloading,
  onOpenWageTypes,
}: Readonly<{
  report: PayrollReport | null;
  monthLabel: string;
  format: PayrollFormat;
  onFormatChange: (format: PayrollFormat) => void;
  /** Ohne Schlüssel die eine Datei, sonst die Datei dieses Arbeitgebers. */
  onDownload: (file?: string) => void;
  /** Die Datei, die gerade lädt; `""` für die eine Datei. */
  downloading: string | null;
  onOpenWageTypes: () => void;
}>) {
  const perEmployer = report?.form === "arbeitgeber";
  const blockers = report ? blockersOf(report, onOpenWageTypes) : [];
  const empty =
    report !== null && report.contracts === 0 && blockers.length === 0;
  const notReadyReason =
    blockers.length > 0
      ? "Erst muss alles unter „Das fehlt noch“ erledigt sein."
      : "In diesem Monat gibt es keinen Wert für die Lohndatei.";

  return (
    <>
      <SectionCard
        concept={payrollConcept}
        title="DATEV-Lohndatei"
        titleBadge={
          report ? (
            <StatusBadge
              label={readinessLabel(report)}
              tone={report.ready ? "green" : "warning"}
              compact
            />
          ) : undefined
        }
        description={fileDescription(report, monthLabel)}
        actions={
          <>
            <SegmentedControl<PayrollFormat>
              ariaLabel="Format der Lohndatei"
              items={FORMAT_ITEMS}
              value={format}
              onChange={onFormatChange}
            />
            {perEmployer ? null : (
              <Button
                type="button"
                size="md"
                variant="primary"
                className="gap-2"
                disabled={!report?.ready}
                disabledReason={report?.ready ? undefined : notReadyReason}
                isLoading={downloading === ""}
                loadingText="Lädt"
                tooltip="Lädt die Datei für DATEV herunter. Das steht im Zugriffsprotokoll jeder Schule."
                onClick={() => onDownload()}
              >
                <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
                Herunterladen
              </Button>
            )}
          </>
        }
        loading={report === null}
        bodyClassName="mt-4 space-y-4"
      >
        {report && empty ? (
          <EmptyState
            variant="compact"
            title="In diesem Monat gilt kein Arbeitsvertrag des Trägers."
            description="Personen ohne Vertrag beim Träger rechnet weiter jede Schule selbst ab."
          />
        ) : null}
        {report && !empty ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                variant="tile"
                label="Verträge"
                value={String(report.contracts)}
              />
              <StatCard
                variant="tile"
                label="Personen"
                value={String(report.people)}
              />
              <StatCard
                variant="tile"
                label="Schulen"
                value={String(report.schools)}
              />
              <StatCard
                variant="tile"
                label={
                  perEmployer ? "Zeilen in den Dateien" : "Zeilen in der Datei"
                }
                value={String(report.lineCount)}
              />
            </div>
            {report.openSchools.length > 0 ? (
              <Alert
                type="warning"
                announce="off"
                message={`Noch nicht abgeschlossen: ${report.openSchools.join(", ")}. Die Werte können sich bis zum Monatsabschluss ändern.`}
              />
            ) : null}
            {perEmployer && report.inSeveralFiles.length > 0 ? (
              <Alert
                type="info"
                announce="off"
                message={`In mehreren Dateien: ${report.inSeveralFiles.map(personName).join(", ")}. Prüfe, ob die Personalnummer bei jedem Arbeitgeber stimmt.`}
              />
            ) : null}
            {perEmployer && report.files.length > 0 ? (
              <FileList
                files={report.files}
                onDownloadFile={(key) => onDownload(key)}
                downloadingFile={downloading}
              />
            ) : null}
            {report.contractChanges.length > 0 ? (
              <Alert
                type="info"
                announce="off"
                message={`Vertragswechsel in diesem Monat: ${report.contractChanges.map(personName).join(", ")}. Der neuere Vertrag rechnet den ganzen Monat an dieser Schule ab.`}
              />
            ) : null}
            {report.kinds.length > 0 ? (
              <div>
                <SectionLabel as="h3" className="mb-2">
                  Nach Art des Vertrags
                </SectionLabel>
                <DataTable
                  columns={kindColumns(report)}
                  rows={[...report.kinds]}
                  getRowKey={(row) => row.kind}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </SectionCard>
      {blockers.length > 0 ? (
        <BlockerList blockers={blockers} perEmployer={perEmployer} />
      ) : null}
    </>
  );
}
