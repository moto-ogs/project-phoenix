"use client";

import { bffFile } from "~/lib/bff-fetch";

// Schließtage und Feiertage des Trägers (#4702). Das Träger-Büro plant
// Schließtage wie Brückentage für einige oder alle Schulen und sieht die
// gesetzlichen Feiertage aus dem Bundesland jeder Schule. Das Bundesland
// legt das moto-Team fest; hier steht es nur zur Information.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";

import {
  calendarDayMarks,
  closingDaySchoolsLabel,
  closingDayYears,
  dayCountLabel,
  formatClosingRange,
  formatDayWithWeekday,
  schoolsInState,
} from "~/components/traeger/closing-day-format";
import {
  ClosingDayHolidayImpact,
  familiesLabel,
} from "~/components/traeger/closing-day-holiday-impact";
import { TraegerHolidayClosureNotices } from "~/components/traeger/traeger-holiday-closure-notices";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import {
  useClosingDayDeletePreview,
  useClosingDayHolidayImpact,
} from "~/components/traeger/use-closing-day-holiday-impact";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ClosingDayModal } from "~/components/planning/closing-day-modal";
import { TraegerYearCalendar } from "~/components/traeger/traeger-year-calendar";
import { Button } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { hasPermission } from "~/lib/auth-utils";
import { calendarConcept } from "~/lib/concepts/calendar";
import { closingDaysConcept } from "~/lib/concepts/closingDays";
import { sendingRefreshInterval } from "~/lib/holiday-closure-notices";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { revalidateOrThrow } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  createTraegerClosingDay,
  updateTraegerClosingDay,
  fetchPendingHolidayClosures,
  fetchTraegerCalendar,
  type TraegerClosingDay,
} from "~/lib/traeger-closing-days";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";

const logger = createLogger({ component: "TraegerClosingDaysPage" });

/** Das Recht, mit dem das Träger-Büro Schließtage plant. */
const SETTINGS_RIGHT = "traeger_settings:manage";

const INFO =
  "Hier planst du Schließtage für deine Schulen, zum Beispiel einen Brückentag. An einem Schließtag hat die OGS geschlossen: keine Ferienbetreuung, keine Termine, kein Soll. Die Feiertage kommen aus dem Bundesland der Schule. Das Bundesland legt das moto-Team fest.";

export default function TraegerClosingDaysPage() {
  const { data: session } = useSession();
  const canManage = hasPermission(session ?? null, SETTINGS_RIGHT);
  const today = useBerlinToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const {
    data,
    loading: calendarLoading,
    error: loadError,
    mutate,
    reloadOrThrow,
  } = useTraegerResource(
    traegerKeys.closingDays(from, to),
    () => fetchTraegerCalendar(from, to),
    "die Schließtage und Feiertage",
    { keepPreviousData: true },
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TraegerClosingDay | null>(null);
  const [deleting, setDeleting] = useState<TraegerClosingDay | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const deleteErrors = useApiFormError();
  const latestDeleteRef = useRef<() => void>(() => undefined);
  const { success: toastSuccess } = useToast();

  // Elternhinweise zu Schließtagen, die Schulen in gebuchte Ferienwochen
  // gelegt haben (#6434, ADR 0196). Solange einer gesendet wird, lädt die
  // Liste regelmäßig neu.
  const pendingResponse = useTraegerResource(
    canManage ? traegerKeys.holidayClosures() : null,
    fetchPendingHolidayClosures,
    "die offenen Hinweise an Eltern",
    {
      refreshInterval: (latest) => sendingRefreshInterval(latest?.notices),
    },
  );
  const pending = pendingResponse.data;
  const holiday = useClosingDayHolidayImpact(modalOpen, editing);
  // Beim Löschen zeigt der Dialog die Tage, die wieder öffnen (#6457), und
  // bestätigt genau die Vorschau, die er zeigt (ADR 0311).
  const deletePreview = useClosingDayDeletePreview(deleting);
  const deletePreviewError = useReadDraftLoadError(
    deletePreview,
    "die gebuchte Ferienbetreuung",
  );

  const schools = useMemo(() => data?.schools ?? [], [data]);
  const schoolName = useCallback(
    (id: string) => schools.find((school) => school.id === id)?.name ?? "–",
    [schools],
  );
  const closingDays = useMemo(() => data?.closingDays ?? [], [data]);
  const regions = useMemo(() => data?.regions ?? [], [data]);
  const marks = useMemo(
    () => (data ? calendarDayMarks(data) : new Map()),
    [data],
  );
  const holidayCount = useMemo(
    () => new Set(regions.flatMap((r) => r.holidays.map((h) => h.date))).size,
    [regions],
  );

  const beginCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const beginEdit = useCallback((day: TraegerClosingDay) => {
    setEditing(day);
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    deleteErrors.clear();
    const result = await deletePreview.confirm();
    setDeleteLoading(false);
    if (result.ok) {
      const families = result.saved;
      toastSuccess(
        families > 0
          ? `Der Schließtag „${deleting.reason}“ ist gelöscht. ${familiesLabel(families)} ${families === 1 ? "bekommt" : "bekommen"} eine E-Mail.`
          : `Der Schließtag „${deleting.reason}“ ist gelöscht.`,
      );
      setDeleting(null);
      void mutate();
      void pendingResponse.mutate();
      return;
    }
    const err = result.error;
    logger.error("traeger_closing_day_delete_failed", {
      closing_day_id: deleting.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Haben sich die Buchungen seit der Vorschau geändert, zeigt der Dialog
    // den neuen Stand; die Meldung wartet darauf und nennt ein gescheitertes
    // Neuladen.
    await deleteErrors.show(err, {
      object: "das Löschen des Schließtags",
      retry: () => latestDeleteRef.current(),
      reload: result.reload,
    });
  }, [
    deleting,
    deleteErrors,
    deletePreview,
    mutate,
    pendingResponse,
    toastSuccess,
  ]);
  useLayoutEffect(() => {
    latestDeleteRef.current = () => void handleDelete();
  });

  const impactFamilies = holiday.impact?.families ?? 0;

  const columns = useMemo<DataTableColumn<TraegerClosingDay>[]>(
    () => [
      {
        key: "range",
        header: "Datum",
        sortValue: (day) => day.startDate,
        stacked: "title",
        render: (day) => (
          <div className="min-w-0">
            <p className="font-medium whitespace-nowrap text-gray-900 tabular-nums">
              {formatClosingRange(day)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{dayCountLabel(day)}</p>
          </div>
        ),
      },
      {
        key: "reason",
        header: "Grund",
        sortValue: (day) => day.reason,
        stacked: "field",
        render: (day) => (
          <span className="wrap-anywhere text-gray-900">{day.reason}</span>
        ),
      },
      {
        key: "schools",
        header: "Gilt für",
        stacked: "field",
        render: (day) => {
          const label = closingDaySchoolsLabel(day, schools);
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
              render: (day: TraegerClosingDay) => (
                <div className="flex justify-end">
                  <OverflowMenu
                    ariaLabel={`Aktionen für ${day.reason}`}
                    items={[
                      {
                        label: "Bearbeiten",
                        icon: <Pencil className="h-4 w-4" aria-hidden />,
                        description:
                          "Öffnet den Schließtag, beim Speichern bekommen betroffene Familien eine E-Mail.",
                        onClick: () => beginEdit(day),
                      },
                      { kind: "separator" },
                      {
                        label: "Löschen",
                        icon: <Trash2 className="h-4 w-4" aria-hidden />,
                        description:
                          "moto fragt vorher nach, dann löscht es den Tag und informiert betroffene Familien.",
                        destructive: true,
                        onClick: () => setDeleting(day),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]
        : []),
    ],
    [beginEdit, canManage, schools],
  );

  const yearItems = closingDayYears(thisYear).map((value) => ({
    value: String(value),
    label: String(value),
  }));
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/closing-days/export", {
          query: listExportQuery(format, {
            from,
            to,
          }),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: `schliesstage-${year}`,
    errorObject: "die Schließtage",
    unavailable: closingDays.length === 0,
  });

  return (
    <TenantPage
      title="Schließtage und Feiertage"
      info={INFO}
      stats={
        data ? (
          <TenantPageStats
            items={[
              {
                value: closingDays.length,
                label: closingDays.length === 1 ? "Schließtag" : "Schließtage",
              },
              { value: holidayCount, label: "Feiertage" },
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={calendarLoading}
      error={loadError}
      searchSlot={
        <SegmentedControl
          ariaLabel="Jahr"
          items={yearItems}
          value={String(year)}
          onChange={(next) => setYear(Number(next))}
        />
      }
      overflowMenu={exportItems}
      actions={
        canManage ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={beginCreate}
            disabled={schools.length === 0}
            tooltip="Plant einen Schließtag für eine oder alle Schulen und informiert betroffene Familien."
            disabledReason={
              data
                ? "Deinem Träger ist noch keine Schule zugeordnet. Das übernimmt das moto-Team."
                : undefined
            }
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Schließtag anlegen
          </Button>
        ) : null
      }
      overlays={
        <>
          <ClosingDayModal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            onSave={async (input) => {
              const withToken = {
                ...input,
                holidayBookingsToken: holiday.impact?.token ?? "",
              };
              try {
                const day = editing
                  ? await updateTraegerClosingDay(editing.id, withToken)
                  : await createTraegerClosingDay(withToken);
                toastSuccess(
                  day.notifiedFamilies > 0
                    ? `Der Schließtag „${day.reason}“ ist gespeichert. ${familiesLabel(day.notifiedFamilies)} ${day.notifiedFamilies === 1 ? "bekommt" : "bekommen"} eine E-Mail.`
                    : `Der Schließtag „${day.reason}“ ist gespeichert.`,
                );
              } catch (err) {
                // Haben sich die Buchungen seit der Vorschau geändert, zeigt
                // der Dialog den neuen Stand; die Meldung sagt es.
                if (
                  err instanceof ApiError &&
                  err.code === "traeger.closing_day_bookings_changed"
                ) {
                  holiday.reload();
                }
                throw err;
              }
            }}
            onSaved={() => {
              void mutate();
              void pendingResponse.mutate();
            }}
            reload={async () => {
              // Der Dialog zeigt den gespeicherten Schließtag (ADR 0311);
              // scheitert das Lesen oder ist er weg, sagt er das.
              const stored = (await reloadOrThrow()).closingDays.find(
                (day) => day.id === editing?.id,
              );
              if (!stored) throw new Error("closing day is gone");
              setEditing(stored);
              return stored;
            }}
            onDraftChange={holiday.onDraftChange}
            consequences={
              <ClosingDayHolidayImpact
                impact={holiday.impact}
                loading={holiday.loading}
                error={holiday.error}
                schoolName={schoolName}
              />
            }
            saveLabel={
              impactFamilies > 0
                ? "Speichern und Eltern informieren"
                : "Speichern"
            }
            saveBlocked={holiday.blocked}
            reasonMaxLength={120}
            initial={editing}
            schools={schools}
            defaultDate={year === thisYear ? today : from}
          />
          <ConfirmDeleteModal
            isOpen={deleting !== null}
            title="Schließtag löschen"
            description={
              deleting ? (
                <p>
                  Der Schließtag „{deleting.reason}“ (
                  {formatClosingRange(deleting)}) wird gelöscht. An diesem Tag
                  gibt es dann wieder Betreuung, Termine und Soll wie sonst.
                </p>
              ) : null
            }
            warningSlot={
              <ClosingDayHolidayImpact
                impact={deleting ? (deletePreview.base ?? null) : null}
                loading={
                  deleting !== null &&
                  !deletePreview.canSubmit &&
                  deletePreview.status !== "loadFailed"
                }
                error={deletePreviewError}
                schoolName={schoolName}
                action="Löschen"
              />
            }
            confirmDisabled={!deletePreview.canSubmit}
            gate={{ mode: "twoStep" }}
            onConfirm={handleDelete}
            onClose={() => {
              deleteErrors.clear();
              setDeleting(null);
            }}
            loading={deleteLoading}
            error={deleteErrors.error}
          />
        </>
      }
    >
      {canManage ? (
        <TraegerHolidayClosureNotices
          pending={pending ?? undefined}
          loadError={pending ? null : pendingResponse.error}
          schoolName={schoolName}
          reload={() => revalidateOrThrow(pendingResponse)}
        />
      ) : null}
      <SectionCard
        title={`Jahresübersicht ${year}`}
        concept={calendarConcept}
        description="Feiertage und Schließtage aller Schulen auf einen Blick."
        loading={calendarLoading}
      >
        <TraegerYearCalendar year={year} marks={marks} todayISO={today} />
      </SectionCard>

      <SectionCard
        title="Schließtage des Trägers"
        concept={closingDaysConcept}
        description="An diesen Tagen hat die OGS der genannten Schulen geschlossen."
        loading={calendarLoading}
      >
        {closingDays.length === 0 ? (
          <EmptyState
            icon={<ConceptIconTile concept={closingDaysConcept} size="page" />}
            title={`Keine Schließtage in ${year}`}
            description={
              canManage
                ? "Du kannst oben mit „Schließtag anlegen“ Schließtage planen, zum Beispiel Brückentage."
                : "Das Träger-Büro hat für dieses Jahr keine Schließtage geplant."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={[...closingDays]}
            getRowKey={(day) => day.id}
            defaultSortKey="range"
            defaultSortDirection="asc"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Feiertage nach Bundesland"
        concept={calendarConcept}
        description="Nur zur Information. Stimmt das Bundesland einer Schule nicht, schreibe dem moto-Team."
        loading={calendarLoading}
      >
        <div
          className={
            regions.length > 1
              ? "compact:gap-4 grid grid-cols-1 gap-6 max-sm:gap-3 lg:grid-cols-2"
              : "compact:gap-4 grid grid-cols-1 gap-6 max-sm:gap-3"
          }
        >
          {regions.map((region) => (
            <section key={region.code} aria-label={region.name}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <SectionLabel as="h3">{region.name}</SectionLabel>
                <StatusBadge
                  label={`${region.holidays.length} Feiertage`}
                  tone="gray"
                />
              </div>
              <p className="mb-3 text-sm text-gray-500">
                Gilt für:{" "}
                {schoolsInState(schools, region.code)
                  .map((school) => school.name)
                  .join(", ")}
              </p>
              <ul className="divide-y divide-gray-100">
                {region.holidays.map((holiday) => (
                  <li
                    key={holiday.date}
                    className="flex items-baseline justify-between gap-3 py-2 text-sm"
                  >
                    <span className="text-gray-900">{holiday.name}</span>
                    <span className="whitespace-nowrap text-gray-500 tabular-nums">
                      {formatDayWithWeekday(holiday.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SectionCard>
    </TenantPage>
  );
}
