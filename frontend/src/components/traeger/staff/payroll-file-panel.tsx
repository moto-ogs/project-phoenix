"use client";

// Die DATEV-Lohndatei des Trägers über alle Schulen (#4712, ADR 0250). Die
// Prüfung zeigt dieselbe Rechnung wie die Datei: Verträge je Art, Zeilen,
// Werte ohne Lohnart und Schulen mit offenem Monat. Was die Datei noch
// verhindert, steht als Liste mit dem nächsten Schritt darunter.

import { DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";

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
      tooltip="Öffnet die Lohnarten und die Nummern für DATEV."
      onClick={onOpenWageTypes}
    >
      Lohnarten öffnen
    </Button>
  );
  const blockers: Blocker[] = [];
  if (report.noWageType) {
    blockers.push({
      key: "no-wage-type",
      text: "Es gibt noch keine Lohnart. Trage die Nummern aus deinem DATEV ein.",
      action: openWageTypes(
        "Lohnarten öffnen, um die erste Lohnart einzutragen",
      ),
    });
  }
  if (report.missingClient) {
    blockers.push({
      key: "missing-client",
      text: "Für LODAS fehlen die Beraternummer oder die Mandantennummer.",
      action: openWageTypes(
        "Lohnarten öffnen, um die Nummern für LODAS einzutragen",
      ),
    });
  }
  for (const person of report.withoutNumber) {
    blockers.push({
      key: `person-${person.recordId}`,
      text: `${personName(person)} hat noch keine Personalnummer.`,
      action: (
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
      ),
    });
  }
  return blockers;
}

function BlockerList({ blockers }: Readonly<{ blockers: readonly Blocker[] }>) {
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
      description="Erst dann entsteht die Lohndatei."
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
  onDownload: () => void;
  downloading: boolean;
  onOpenWageTypes: () => void;
}>) {
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
              label={report.ready ? "Bereit" : "Noch nicht bereit"}
              tone={report.ready ? "green" : "warning"}
              compact
            />
          ) : undefined
        }
        description={`${monthLabel} · Eine Datei für alle Schulen. Jede Art des Vertrags hat eigene Lohnarten.`}
        actions={
          <>
            <SegmentedControl<PayrollFormat>
              ariaLabel="Format der Lohndatei"
              items={FORMAT_ITEMS}
              value={format}
              onChange={onFormatChange}
            />
            <Button
              type="button"
              size="md"
              variant="primary"
              className="gap-2"
              disabled={!report?.ready}
              disabledReason={report?.ready ? undefined : notReadyReason}
              isLoading={downloading}
              loadingText="Lädt"
              tooltip="Lädt die Datei für DATEV herunter. Das steht im Zugriffsprotokoll jeder Schule."
              onClick={onDownload}
            >
              <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
              Herunterladen
            </Button>
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
                label="Zeilen in der Datei"
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
                  stackedOnMobile
                />
              </div>
            ) : null}
          </>
        ) : null}
      </SectionCard>
      {blockers.length > 0 ? <BlockerList blockers={blockers} /> : null}
    </>
  );
}
