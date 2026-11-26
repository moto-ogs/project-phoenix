"use client";

/**
 * OpeningChangesEditor lists the days on which the OGS opens or closes at
 * other times than usual (#7654), for example a shorter day before the
 * holidays. It sits beside the closing days on „Schuljahr und Kalender“ and
 * needs the same rights. The usual times are the settings „Öffnungszeiten“.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { OpeningChangeModal } from "~/components/planning/opening-change-modal";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
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
            <p className="font-medium wrap-anywhere text-gray-900">
              {change.reason}
            </p>
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
        render: (change) => (
          <div className="flex justify-end">
            <OverflowMenu
              ariaLabel={`Aktionen für ${change.reason}`}
              items={[
                {
                  label: "Löschen",
                  icon: <Trash2 className="h-4 w-4" aria-hidden />,
                  destructive: true,
                  description: "moto fragt vorher nach und löscht dann den Tag",
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
        getRowKey={(change) => change.id}
        defaultSortKey="days"
        defaultSortDirection="asc"
        isLoading={loading}
      />
    );

  return (
    <>
      <SectionCard
        title="Geänderte Öffnungszeiten"
        description="Tage, an denen die OGS zu anderen Zeiten öffnet oder schließt, z. B. ein kürzerer Tag vor den Ferien. Die üblichen Zeiten stehen in den Einstellungen unter „Öffnungszeiten“."
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
