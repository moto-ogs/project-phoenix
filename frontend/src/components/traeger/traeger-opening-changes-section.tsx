"use client";

/**
 * TraegerOpeningChangesSection lists the days on which the OGS of some or
 * all schools of the Träger opens or closes at other times (#8202), on the
 * page of the Träger's closing days. The Büro with „Einstellungen
 * verwalten“ plans, changes and deletes them; the schools read them as
 * „Vom Träger“ and cannot change them. A saved day is changed in place.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { closingDaySchoolsLabel } from "~/components/traeger/closing-day-format";
import { TraegerOpeningChangeEditCard } from "~/components/traeger/traeger-opening-change-edit-card";
import { TraegerOpeningChangeModal } from "~/components/traeger/traeger-opening-change-modal";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  formatOpeningChangeDays,
  formatOpeningChangeHours,
} from "~/lib/opening-change-api";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import type { TraegerCalendarSchool } from "~/lib/traeger-closing-days";
import {
  deleteTraegerOpeningChange,
  fetchTraegerOpeningChanges,
  type TraegerOpeningChange,
} from "~/lib/traeger-opening-changes";

const logger = createLogger({ component: "TraegerOpeningChangesSection" });

const EMPTY: TraegerOpeningChange[] = [];

export function TraegerOpeningChangesSection({
  year,
  from,
  to,
  schools,
  canManage,
}: Readonly<{
  year: number;
  /** The year the page shows, as „YYYY-MM-DD“. */
  from: string;
  to: string;
  schools: readonly TraegerCalendarSchool[];
  canManage: boolean;
}>) {
  const { data, loading, error, mutate, reloadOrThrow } = useTraegerResource(
    traegerKeys.openingChanges(from, to),
    () => fetchTraegerOpeningChanges(from, to),
    "die geänderten Öffnungszeiten",
    { keepPreviousData: true },
  );
  const changes = data ?? EMPTY;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = changes.find((change) => change.id === editingId);
  const [deleting, setDeleting] = useState<TraegerOpeningChange | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const deleteErrors = useApiFormError();
  const latestDeleteRef = useRef<() => void>(() => undefined);
  const { success: toastSuccess } = useToast();

  const showDeleteError = deleteErrors.show;
  const clearDeleteError = deleteErrors.clear;
  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    clearDeleteError();
    try {
      await deleteTraegerOpeningChange(deleting.id);
      toastSuccess(`„${deleting.reason}“ ist gelöscht.`);
      setDeleting(null);
      void mutate();
    } catch (err) {
      logger.error("traeger_opening_change_delete_failed", {
        opening_change_id: deleting.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await showDeleteError(err, {
        object: "das Löschen der geänderten Öffnungszeit",
        retry: () => latestDeleteRef.current(),
      });
    } finally {
      setDeleteLoading(false);
    }
  }, [deleting, mutate, toastSuccess, showDeleteError, clearDeleteError]);
  useLayoutEffect(() => {
    latestDeleteRef.current = () => void handleDelete();
  });

  const columns = useMemo<DataTableColumn<TraegerOpeningChange>[]>(
    () => [
      {
        key: "days",
        header: "Datum",
        sortValue: (change) => change.startDate,
        stacked: "title",
        render: (change) => (
          <div className="min-w-0">
            <p className="font-medium whitespace-nowrap text-gray-900 tabular-nums">
              {formatOpeningChangeDays(change)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
              {formatOpeningChangeHours(change)}
            </p>
          </div>
        ),
      },
      {
        key: "reason",
        header: "Anlass",
        sortValue: (change) => change.reason,
        stacked: "field",
        render: (change) => (
          <span className="wrap-anywhere text-gray-900">{change.reason}</span>
        ),
      },
      {
        key: "schools",
        header: "Gilt für",
        stacked: "field",
        render: (change) => {
          const label = closingDaySchoolsLabel(change, schools);
          return label === "Alle Schulen" ? (
            <StatusBadge label="Alle Schulen" tone="green" />
          ) : (
            <span className="text-sm wrap-anywhere text-gray-600">{label}</span>
          );
        },
      },
      ...(canManage
        ? [
            {
              key: "actions",
              header: "",
              align: "right" as const,
              className: "w-px",
              headerClassName: "w-px",
              render: (change: TraegerOpeningChange) => (
                <div className="flex justify-end">
                  <OverflowMenu
                    ariaLabel={`Aktionen für ${change.reason}`}
                    items={[
                      {
                        label: "Bearbeiten",
                        icon: <Pencil className="h-4 w-4" aria-hidden />,
                        description: "Öffnet die Felder dieses Tags zum Ändern",
                        onClick: () => setEditingId(change.id),
                      },
                      { kind: "separator" },
                      {
                        label: "Löschen",
                        icon: <Trash2 className="h-4 w-4" aria-hidden />,
                        destructive: true,
                        description:
                          "moto fragt vorher nach und löscht dann den Tag",
                        onClick: () => setDeleting(change),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]
        : []),
    ],
    [canManage, schools],
  );

  const reloadEditing = useCallback(async () => {
    const found = (await reloadOrThrow()).find(
      (change) => change.id === editingId,
    );
    if (!found) throw new Error("opening change is gone");
    return found;
  }, [reloadOrThrow, editingId]);
  const storeEditing = useCallback(
    (stored: TraegerOpeningChange) =>
      mutate(
        (current) =>
          current?.map((change) => (change.id === stored.id ? stored : change)),
        { revalidate: true },
      ),
    [mutate],
  );

  if (editing && canManage) {
    return (
      <TraegerOpeningChangeEditCard
        change={editing}
        reload={reloadEditing}
        onStored={storeEditing}
        onClose={() => setEditingId(null)}
        schools={schools}
        minDate={from}
        maxDate={to}
      />
    );
  }

  return (
    <>
      <SectionCard
        title="Geänderte Öffnungszeiten"
        description="An diesen Tagen öffnet oder schließt die OGS der genannten Schulen zu anderen Zeiten. Die Schulen sehen den Tag mit „Vom Träger“ und können ihn nicht ändern."
        loading={loading}
        actions={
          canManage ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setModalOpen(true)}
              disabled={schools.length === 0}
              disabledReason="Deinem Träger ist noch keine Schule zugeordnet. Das übernimmt das moto-Team."
              className="shrink-0 gap-2"
              tooltip="Öffnet ein leeres Formular für einen Tag mit anderen Öffnungszeiten."
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Tag anlegen
            </Button>
          ) : null
        }
      >
        <LoadErrorAlert error={error} className={data ? "mb-4" : undefined} />
        {error && !data ? null : changes.length === 0 ? (
          <EmptyState
            variant="compact"
            title={`Keine geänderten Öffnungszeiten in ${year}`}
            description={
              canManage
                ? "Öffnet oder schließt die OGS an einem Tag zu anderen Zeiten, trägst du den Tag oben mit „Tag anlegen“ ein."
                : "Das Träger-Büro hat für dieses Jahr keine geänderten Öffnungszeiten geplant."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={[...changes]}
            getRowKey={(change) => change.id}
            defaultSortKey="days"
            defaultSortDirection="asc"
          />
        )}
      </SectionCard>

      {canManage ? (
        <TraegerOpeningChangeModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => void mutate()}
          schools={schools}
          minDate={from}
          maxDate={to}
        />
      ) : null}

      <ConfirmDeleteModal
        isOpen={deleting !== null}
        title="Geänderte Öffnungszeit löschen"
        description={
          deleting ? (
            <p>
              „{deleting.reason}“ ({formatOpeningChangeDays(deleting)}) wird
              gelöscht. An diesem Tag gelten an den Schulen dann wieder die
              üblichen Öffnungszeiten.
            </p>
          ) : null
        }
        gate={{ mode: "twoStep" }}
        onConfirm={handleDelete}
        onClose={() => {
          clearDeleteError();
          setDeleting(null);
        }}
        loading={deleteLoading}
        error={deleteErrors.error}
      />
    </>
  );
}
