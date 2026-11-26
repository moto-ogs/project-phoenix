"use client";

/**
 * OpeningChangesEditor lists the days on which the OGS opens or closes at
 * other times than usual (#7654), for example a shorter day before the
 * holidays. It sits beside the closing days on „Schuljahr und Kalender“ and
 * needs the same rights. The usual times are the settings „Öffnungszeiten“.
 * A saved day is changed in place (#8173): the card switches to its fields.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { OpeningChangeEditCard } from "~/components/planning/opening-change-edit-card";
import { OpeningChangeModal } from "~/components/planning/opening-change-modal";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  formatOpeningChangeDays,
  formatOpeningChangeHours,
  type OpeningChange,
  openingChangeService,
} from "~/lib/opening-change-api";
import { useSWRAuth } from "~/lib/swr";
import { closingDayKeys } from "~/lib/swr/staff-keys";

const logger = createLogger({ component: "OpeningChangesEditor" });

const EMPTY: OpeningChange[] = [];

/** The list shows the last month and the coming year. */
function shiftDays(iso: string, days: number): string {
  const day = parseISODate(iso);
  day.setDate(day.getDate() + days);
  return toISODate(day);
}

export function OpeningChangesEditor() {
  const today = useBerlinToday();
  const from = shiftDays(today, -30);
  const to = shiftDays(today, 365);
  const list = useSWRAuth(closingDayKeys.openingChanges(from, to), () =>
    openingChangeService.list(from, to),
  );
  const { data, error: listError, mutate } = list;
  const changes = data ?? EMPTY;
  const loadError = useSwrResourceLoadError(
    [{ data, error: listError }],
    "die Liste der geänderten Öffnungszeiten",
    () => mutate(),
  );
  const loadFailed = loadError.failure !== undefined;
  const loading = data === undefined && !loadFailed;
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<OpeningChange | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The school changes only its own days; an ID of the Träger may match one.
  const editing = changes.find(
    (change) => !change.fromTraeger && change.id === editingId,
  );
  const hasTraegerDays = changes.some((change) => change.fromTraeger);
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
      await openingChangeService.delete(deleting.id);
      toastSuccess(`„${deleting.reason}“ ist gelöscht.`);
      setDeleting(null);
      void mutate();
    } catch (err) {
      logger.error("opening_change_delete_failed", {
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

  const columns = useMemo<DataTableColumn<OpeningChange>[]>(
    () => [
      {
        key: "days",
        header: "Tag",
        stacked: "hidden",
        className: "hidden sm:table-cell",
        headerClassName: "hidden sm:table-cell",
        sortValue: (change) => change.startDate,
        render: (change) => (
          <span className="text-sm whitespace-nowrap text-gray-600">
            {formatOpeningChangeDays(change)}
          </span>
        ),
      },
      {
        key: "hours",
        header: "Geöffnet",
        stacked: "hidden",
        className: "hidden sm:table-cell",
        headerClassName: "hidden sm:table-cell",
        render: (change) => (
          <span className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
            {formatOpeningChangeHours(change)}
          </span>
        ),
      },
      {
        key: "reason",
        header: "Anlass",
        stacked: "title",
        sortValue: (change) => change.reason,
        render: (change) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium wrap-anywhere text-gray-900">
                {change.reason}
              </p>
              {change.fromTraeger ? (
                <StatusBadge label="Vom Träger" tone="blue" />
              ) : null}
            </div>
            {/* Unter sm stehen Tag und Uhrzeit hier statt in eigenen Spalten. */}
            <p className="mt-0.5 text-xs leading-5 break-words text-gray-500 sm:hidden">
              {formatOpeningChangeDays(change)} ·{" "}
              {formatOpeningChangeHours(change)}
            </p>
          </div>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        className: "w-px",
        headerClassName: "w-px",
        render: (change) =>
          change.fromTraeger ? null : (
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
    ],
    [],
  );

  const failedWithoutData = loadFailed && changes.length === 0;
  const body =
    !loading && !loadFailed && changes.length === 0 ? (
      <EmptyState
        variant="compact"
        title="Keine geänderten Öffnungszeiten"
        description="Öffnet oder schließt die OGS an einem Tag zu anderen Zeiten, trägst du den Tag hier ein."
      />
    ) : failedWithoutData ? null : (
      <DataTable
        columns={columns}
        rows={changes}
        getRowKey={(change) =>
          `${change.fromTraeger ? "traeger" : "school"}-${change.id}`
        }
        defaultSortKey="days"
        defaultSortDirection="asc"
        isLoading={loading}
      />
    );

  const reloadEditing = useCallback(async () => {
    const found = (await mutate())?.find((change) => change.id === editingId);
    if (!found) throw new Error("opening change is gone");
    return found;
  }, [mutate, editingId]);
  const storeEditing = useCallback(
    (stored: OpeningChange) =>
      mutate(
        (current) =>
          current?.map((change) =>
            !change.fromTraeger && change.id === stored.id ? stored : change,
          ),
        { revalidate: true },
      ),
    [mutate],
  );

  if (editing) {
    return (
      <OpeningChangeEditCard
        change={editing}
        reload={reloadEditing}
        onStored={storeEditing}
        onClose={() => setEditingId(null)}
        minDate={from}
        maxDate={to}
      />
    );
  }

  return (
    <>
      <SectionCard
        title="Geänderte Öffnungszeiten"
        description={
          hasTraegerDays
            ? "Tage, an denen die OGS zu anderen Zeiten öffnet oder schließt, z. B. ein kürzerer Tag vor den Ferien. Die üblichen Zeiten stehen in den Einstellungen unter „Öffnungszeiten“. Tage mit „Vom Träger“ plant dein Träger. Ändern kann sie nur das Träger-Büro."
            : "Tage, an denen die OGS zu anderen Zeiten öffnet oder schließt, z. B. ein kürzerer Tag vor den Ferien. Die üblichen Zeiten stehen in den Einstellungen unter „Öffnungszeiten“."
        }
        actions={
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setModalOpen(true)}
            className="shrink-0 gap-2"
            tooltip="Öffnet ein leeres Formular für einen Tag mit anderen Öffnungszeiten."
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Tag anlegen
          </Button>
        }
      >
        <LoadErrorAlert
          error={loadError.error}
          className={failedWithoutData ? undefined : "mb-4"}
        />
        {body}
      </SectionCard>

      <OpeningChangeModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => void mutate()}
        minDate={from}
        maxDate={to}
      />

      <ConfirmDeleteModal
        isOpen={deleting !== null}
        title="Geänderte Öffnungszeit löschen"
        description={
          deleting ? (
            <p>
              „{deleting.reason}“ ({formatOpeningChangeDays(deleting)}) wird
              gelöscht. An diesem Tag gelten dann wieder die üblichen
              Öffnungszeiten.
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
