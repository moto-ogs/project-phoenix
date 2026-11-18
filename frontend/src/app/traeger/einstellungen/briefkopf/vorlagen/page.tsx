"use client";

// Vorlagen des Trägers (#4677, ADR 0152): für jede Dokumentart Betreff,
// Anrede, Brieftext und Grußformel mit Platzhaltern. Die Liste zeigt, ob eine
// Art die Standardvorlage oder eine eigene Version nutzt. Lesen darf, wer
// „Übersicht lesen“ hat, ändern nur, wer „Einstellungen“ hat.

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useTraegerListExportItems,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { formatDate } from "~/lib/date-helpers";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  DOCUMENT_TEMPLATE_KIND_LABELS,
  DOCUMENT_TEMPLATE_KIND_USE,
  type DocumentTemplateSummary,
  fetchDocumentTemplates,
} from "~/lib/traeger-document-templates";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

const COLUMNS: DataTableColumn<DocumentTemplateSummary>[] = [
  {
    key: "kind",
    header: "Dokument",
    // From the tablet on a name keeps one line; the purpose beside it wraps.
    render: (template) => (
      <span className="font-medium text-gray-900 md:whitespace-nowrap">
        {DOCUMENT_TEMPLATE_KIND_LABELS[template.kind]}
      </span>
    ),
    stacked: "title",
  },
  {
    // Its own column, so a phone shows the whole sentence under the name
    // and its state, across the full width of the row.
    key: "use",
    header: "Wofür",
    render: (template) => (
      <span className="text-sm text-pretty text-gray-600">
        {DOCUMENT_TEMPLATE_KIND_USE[template.kind]}
      </span>
    ),
    // On a phone the whole sentence too: its condition („wenn unter
    // Dokumentarten …“) is what tells two templates apart.
    stackedLabel: false,
  },
  {
    key: "state",
    header: "Vorlage",
    render: (template) =>
      template.standard ? (
        <StatusBadge label="Standardvorlage" tone="gray" />
      ) : (
        <StatusBadge
          label={`Eigene, Version ${template.version}`}
          tone="green"
        />
      ),
    stacked: "meta",
  },
  {
    key: "updated",
    header: "Gespeichert am",
    headerClassName: "whitespace-nowrap",
    render: (template) =>
      template.updatedAt ? formatDate(template.updatedAt) : "–",
    // On a phone name, state and purpose make the row; the date stays in
    // the template itself, as before.
    stacked: "hidden",
  },
];

export default function TraegerVorlagenPage() {
  const router = useRouter();
  const {
    data: templates,
    loading,
    error,
  } = useTraegerResource(
    traegerKeys.documentTemplates(),
    fetchDocumentTemplates,
    "die Liste der Vorlagen",
  );

  const own = templates?.filter((template) => !template.standard).length ?? 0;
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        "/api/traeger/master-data/document-templates/export",
        format,
      ),
    scope: traegerExportScope(),
    fallbackName: "vorlagen",
    errorObject: "die Liste der Vorlagen",
    unavailable: !templates || templates.length === 0,
  });

  return (
    <TenantPage
      title="Vorlagen"
      back
      backHref={traegerPath("/traeger/einstellungen/briefkopf")}
      backLabel="Zurück zu Briefkopf und Vorlagen"
      info="Hier legst du fest, was in den Briefen deines Trägers steht. Platzhalter wie {{familienname}} füllt moto für jede Familie aus. Logo, Absender und Fußzeile kommen aus dem Briefkopf."
      stats={
        templates ? (
          <TenantPageStats
            items={[
              { value: templates.length, label: "Dokumente" },
              {
                value: own,
                label: own === 1 ? "eigene Vorlage" : "eigene Vorlagen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      overflowMenu={exportItems}
      error={error}
      loading={loading}
    >
      {templates ? (
        <DataTable
          columns={COLUMNS}
          rows={templates}
          getRowKey={(template) => template.kind}
          stackedOnMobile
          // Name and state in the head line, the purpose below them across
          // the full width: beside the state it took four to six lines.
          stackedLayout="lines"
          onRowClick={(template) =>
            router.push(
              traegerPath(
                `/traeger/einstellungen/briefkopf/vorlagen/${template.kind}`,
              ),
            )
          }
          emptyState={
            <EmptyState
              icon={<FileText className="h-12 w-12" aria-hidden="true" />}
              title="Keine Vorlagen."
            />
          }
        />
      ) : null}
    </TenantPage>
  );
}
