"use client";

// Verlauf des Träger-Büros (#5474): wer wann eine Person eingeladen, eine
// Einladung zurückgenommen, Rollen oder einen Namen (#4693) geändert oder
// eine Person entfernt hat.
// Nur zum Lesen, neueste zuerst, seitenweise.

import { useState } from "react";
import { History } from "lucide-react";
import { TraegerListExportMenu } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { formatBerlinDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchTraegerAccountHistory,
  type TraegerAccountChangeAction,
  type TraegerAccountHistoryEntry,
  type TraegerAccountHistoryPage,
} from "~/lib/traeger-api";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { TRAEGER_ROLE_LABELS, type TraegerRole } from "~/lib/traeger-roles";

const logger = createLogger({ component: "TraegerAccountHistory" });

const ACTION_LABELS: Readonly<Record<TraegerAccountChangeAction, string>> = {
  invitation_created: "Eingeladen",
  invitation_revoked: "Einladung zurückgenommen",
  invitation_accepted: "Einladung angenommen",
  roles_changed: "Rollen geändert",
  member_removed: "Entfernt",
  name_changed: "Name geändert",
};

const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

function roleNames(roles: readonly TraegerRole[]): string {
  return roles.map((role) => TRAEGER_ROLE_LABELS[role]).join(", ") || "keine";
}

/** The roles or the name a change names, in one line. */
function historyDetail(entry: TraegerAccountHistoryEntry): string {
  switch (entry.action) {
    case "name_changed":
      return `Neuer Name: ${entry.targetName || "–"}.`;
    case "roles_changed":
      return `Vorher: ${roleNames(entry.rolesBefore)}. Jetzt: ${roleNames(entry.rolesAfter)}.`;
    case "member_removed":
      return `Bisher: ${roleNames(entry.rolesBefore)}.`;
    case "invitation_revoked":
      return `Rolle der Einladung: ${roleNames(entry.rolesBefore)}.`;
    default:
      return `Rolle: ${roleNames(entry.rolesAfter)}.`;
  }
}

const COLUMNS: DataTableColumn<TraegerAccountHistoryEntry>[] = [
  {
    key: "occurredAt",
    header: "Zeitpunkt",
    render: (entry) => (
      <span className="whitespace-nowrap text-gray-900">
        {formatBerlinDate(entry.occurredAt)},{" "}
        {BERLIN_TIME.format(new Date(entry.occurredAt))} Uhr
      </span>
    ),
    stacked: "meta",
  },
  {
    key: "action",
    header: "Was",
    render: (entry) => (
      <span>
        <span className="font-medium text-gray-900">
          {ACTION_LABELS[entry.action]}
        </span>
        <span className="block text-gray-600">{historyDetail(entry)}</span>
      </span>
    ),
    stacked: "title",
  },
  {
    key: "target",
    header: "Betrifft",
    render: (entry) => (
      <span className="wrap-anywhere">{entry.targetEmail || "–"}</span>
    ),
    stacked: "field",
  },
  {
    key: "actor",
    header: "Von",
    render: (entry) => (
      <span className="wrap-anywhere">
        {entry.actorEmail || "Gelöschtes Konto"}
      </span>
    ),
    stacked: "field",
  },
];

/**
 * The history section of the page „Mitglieder und Rollen“. A change on the
 * page invalidates `traegerKeys.accountHistoryFamily`; the history then reads
 * its first page again and drops the older pages it had loaded.
 * „Herunterladen“ gives the whole history as PDF, Excel or CSV (#4718);
 * `onExportError` hears a failed download first.
 */
export function TraegerAccountHistory({
  onExportError,
}: Readonly<{
  onExportError?: (error: unknown) => void;
}>) {
  const {
    data: first,
    loading,
    error,
  } = useTraegerResource(
    traegerKeys.accountHistory(),
    () => fetchTraegerAccountHistory(),
    "die Liste der Änderungen",
  );
  // Older pages belong to the first page they continue.
  const [older, setOlder] = useState<{
    readonly after: TraegerAccountHistoryPage;
    readonly entries: readonly TraegerAccountHistoryEntry[];
    readonly hasMore: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { show: showActionError } = useApiErrorDisplay();
  const continued = older && older.after === first ? older : null;
  const entries = first
    ? [...first.entries, ...(continued?.entries ?? [])]
    : [];
  const hasMore = continued ? continued.hasMore : (first?.hasMore ?? false);

  const loadMore = async () => {
    const last = entries.at(-1);
    if (!last || !first) return;
    setLoadingMore(true);
    try {
      const page = await fetchTraegerAccountHistory(last.id);
      // After a reload of the first page meanwhile, this answer shows no more.
      setOlder({
        after: first,
        entries: [...(continued?.entries ?? []), ...page.entries],
        hasMore: page.hasMore,
      });
    } catch (err) {
      logger.error("traeger_account_history_load_more_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, { object: "die älteren Einträge" });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SectionCard
      title="Verlauf"
      description="Wer wann Personen eingeladen, Rollen oder Namen geändert oder entfernt hat. Nur zum Lesen."
      action={
        <TraegerListExportMenu
          download={(format) =>
            downloadTraegerList("/api/traeger/accounts/history/export", format)
          }
          scope="Träger-Büro"
          ariaLabel="Verlauf herunterladen"
          fallbackName="verlauf-traeger-buero"
          errorObject="den Verlauf"
          unavailable={loading || entries.length === 0}
          onError={onExportError}
        />
      }
    >
      {error ? (
        <LoadErrorAlert error={error} actionLayout="responsive" />
      ) : (
        <div className="flex flex-col gap-4">
          <DataTable
            columns={COLUMNS}
            rows={[...entries]}
            getRowKey={(entry) => entry.id}
            isLoading={loading}
            loadingRowCount={3}
            stackedOnMobile
            emptyState={
              <EmptyState
                icon={<History className="h-12 w-12" aria-hidden="true" />}
                title="Noch keine Änderungen im Träger-Büro."
              />
            }
          />
          {hasMore && !loading ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="md"
                isLoading={loadingMore}
                loadingText="Lädt …"
                tooltip="Zeigt weitere, ältere Änderungen unten in der Liste."
                onClick={() => void loadMore()}
              >
                Ältere Einträge laden
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
