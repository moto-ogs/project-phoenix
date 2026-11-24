"use client";

// Cross-staff Änderungsprotokoll (#1417): who changed whose working time,
// when, and why — across session edits, absence decisions, Stundenkonto
// bookings, month close/reopen, and deletion tombstones. Rendered only with
// time_tracking:manage (the page never mounts it otherwise, so no request
// fires without the permission).

import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { ISODatePicker } from "~/components/ui/date-picker";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  FIELD_LABELS,
  formatEditValue,
} from "~/components/time-tracking/edit-history-accordion";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { staffTimeKeys } from "~/lib/swr/staff-keys";
import {
  auditLogSourceLabels,
  staffAuditLogService,
  type AuditLogEvent,
  type AuditLogPage,
  type AuditLogSource,
} from "~/lib/staff-audit-log-api";
import {
  berlinClockFromISO,
  formatBerlinDate,
  formatDate,
} from "~/lib/date-helpers";
import { formatSignedDuration } from "~/components/staff/staff-time-views";
import {
  absenceTypeLabels,
  balanceAdjustmentTypeLabel,
  type AbsenceType,
  type BalanceAdjustmentType,
} from "~/lib/time-tracking-helpers";

const log = createLogger({ component: "StaffAuditLog" });

/**
 * The absence wording an audit entry shows. A school-defined Abwesenheitsart
 * (#2403) wins so the history reads the same name the entry was filed under —
 * the audit trail is exactly where a renamed-away "Sonstige" would confuse.
 */
function absenceAuditTypeLabel(detail: Record<string, unknown>): string {
  const custom = detail.absence_type_label;
  if (typeof custom === "string" && custom !== "") return custom;
  return (
    absenceTypeLabels[detail.absence_type as AbsenceType] ??
    String(detail.absence_type ?? "")
  );
}

const PAGE_SIZE = 50;

interface AuditLogStaffOption {
  id: string;
  name: string;
}

interface StaffAuditLogProps {
  staffOptions: AuditLogStaffOption[];
}

interface SessionEditField {
  field: string;
  old: string | null;
  new: string | null;
}

const absenceStatusLabels: Record<string, string> = {
  reported: "gemeldet",
  requested: "beantragt",
  question: "Rückfrage",
  approved: "genehmigt",
  declined: "abgelehnt",
  canceled: "storniert",
};

// Vacation takeover values are half-day granular and signed (#2132).
function formatOpeningDays(value: unknown): string {
  const days = typeof value === "number" ? value : 0;
  const formatted = days.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return `${formatted} ${days === 1 ? "Tag" : "Tage"}`;
}

// One German sentence per event; the typed detail payloads stay readable
// instead of being squeezed into a shared column schema.
function describeEvent(event: AuditLogEvent): string {
  const d = event.detail;
  switch (event.source) {
    case "session_edit": {
      const fields = (d.fields as SessionEditField[] | undefined) ?? [];
      const parts = fields.map(
        (f) =>
          `${FIELD_LABELS[f.field] ?? f.field}: ${formatEditValue(f.field, f.old)} → ${formatEditValue(f.field, f.new)}`,
      );
      const day = typeof d.session_date === "string" ? d.session_date : "";
      return `Session vom ${formatDate(day)}: ${parts.join(", ")}`;
    }
    case "absence": {
      const type = absenceAuditTypeLabel(d);
      const from =
        typeof d.date_start === "string" ? formatDate(d.date_start) : "";
      const to = typeof d.date_end === "string" ? formatDate(d.date_end) : "";
      const status =
        absenceStatusLabels[String(d.to_status)] ?? String(d.to_status ?? "");
      const range = from === to ? from : `${from}–${to}`;
      // Umbuchung (#3258): der Status bleibt, die Art ändert sich.
      if (typeof d.from_absence_type === "string") {
        const before = absenceAuditTypeLabel({
          absence_type: d.from_absence_type,
          absence_type_label: d.from_absence_type_label,
        });
        const after = absenceAuditTypeLabel({
          absence_type: d.to_absence_type,
          absence_type_label: d.to_absence_type_label,
        });
        return `Art geändert ${range}: ${before} → ${after}`;
      }
      return `${type} ${range}: ${status}`;
    }
    case "adjustment": {
      const type = balanceAdjustmentTypeLabel(
        String(d.type ?? "") as BalanceAdjustmentType,
      );
      const minutes = typeof d.minutes_delta === "number" ? d.minutes_delta : 0;
      const day =
        typeof d.effective_date === "string"
          ? formatDate(d.effective_date)
          : "";
      return `${type} ${formatSignedDuration(minutes)} zum ${day}`;
    }
    case "vacation_opening": {
      const year = typeof d.year === "number" ? d.year : "";
      const day =
        typeof d.effective_date === "string"
          ? formatDate(d.effective_date)
          : "";
      return `Urlaubs-Übernahme ${year}: ${formatOpeningDays(d.entered_remaining_days)} Rest zum ${day}`;
    }
    case "absence_type_allowance": {
      const label =
        typeof d.absence_type_label === "string"
          ? d.absence_type_label
          : "Abwesenheitsart";
      const days =
        typeof d.new_entitled_days === "number" ? d.new_entitled_days : 0;
      return `${label} ${String(d.year ?? "")}: Anspruch ${formatOpeningDays(days)}`;
    }
    case "vacation_quota": {
      const entitled =
        typeof d.new_entitled_days === "number" ? d.new_entitled_days : 0;
      const carryover =
        typeof d.new_carryover_days === "number" ? d.new_carryover_days : 0;
      const extra =
        carryover > 0 ? ` + ${formatOpeningDays(carryover)} Übertrag` : "";
      return `Urlaubsanspruch ${String(d.year ?? "")}: ${formatOpeningDays(entitled)}${extra}`;
    }
    case "month_close": {
      const count = typeof d.account_count === "number" ? d.account_count : 0;
      return `Monat ${String(d.month).padStart(2, "0")}/${String(d.year)} abgeschlossen (${count} ${count === 1 ? "Konto" : "Konten"})`;
    }
    case "month_reopen": {
      return `Monat ${String(d.month).padStart(2, "0")}/${String(d.year)} wieder geöffnet`;
    }
    case "deletion": {
      const payload = (d.payload ?? {}) as Record<string, unknown>;
      if (d.deleted_source === "balance_adjustment") {
        const type = balanceAdjustmentTypeLabel(
          String(payload.type ?? "") as BalanceAdjustmentType,
        );
        const minutes =
          typeof payload.minutes_delta === "number" ? payload.minutes_delta : 0;
        return `Buchung gelöscht: ${type} ${formatSignedDuration(minutes)}`;
      }
      if (d.deleted_source === "vacation_opening") {
        const year = typeof payload.year === "number" ? payload.year : "";
        return `Urlaubs-Übernahme gelöscht: ${year} (${formatOpeningDays(payload.entered_remaining_days)} Rest)`;
      }
      const type = absenceAuditTypeLabel(payload);
      const from =
        typeof payload.date_start === "string"
          ? formatDate(payload.date_start)
          : "";
      const to =
        typeof payload.date_end === "string"
          ? formatDate(payload.date_end)
          : "";
      return `Abwesenheit gelöscht: ${type} ${from === to ? from : `${from}–${to}`}`;
    }
    case "personnel_number": {
      const oldValue = typeof d.old_value === "string" ? d.old_value : "";
      const newValue = typeof d.new_value === "string" ? d.new_value : "";
      const from = oldValue === "" ? "nicht gesetzt" : oldValue;
      const to = newValue === "" ? "entfernt" : newValue;
      return `Personalnummer: ${from} → ${to}`;
    }
  }
}

function actorLabel(event: AuditLogEvent): string {
  // Abschluss und Wiederöffnen des Trägers (#4711) haben kein Personal der
  // Schule als Urheber.
  if (event.detail.by_traeger === true) return "Personalverwaltung des Trägers";
  if (event.actorIsSystem) return "System";
  if (!event.actorName) return "Unbekannt";
  return event.actorIsSelf ? `${event.actorName} (selbst)` : event.actorName;
}

function staffLabel(event: AuditLogEvent) {
  if (event.staffId === null) {
    return <span className="text-gray-500">Alle Mitarbeitenden</span>;
  }
  if (event.staffName) return event.staffName;
  return <span className="text-gray-500">Unbekannte/ehemalige Person</span>;
}

const sourceOptions = [
  { value: "all", label: "Alle Bereiche" },
  ...Object.entries(auditLogSourceLabels).map(([value, label]) => ({
    value,
    label,
  })),
];

export function StaffAuditLog({ staffOptions }: StaffAuditLogProps) {
  const [staffId, setStaffId] = useState("all");
  const [actorId, setActorId] = useState("all");
  const [source, setSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      staffId: staffId === "all" ? undefined : staffId,
      actorId: actorId === "all" ? undefined : actorId,
      sources: source === "all" ? undefined : [source as AuditLogSource],
      limit: PAGE_SIZE,
    }),
    [from, to, staffId, actorId, source],
  );
  const firstPage = useSWRAuth(
    staffTimeKeys.auditLog(query),
    () => staffAuditLogService.getAuditLog(query),
    { keepPreviousData: false },
  );
  // Ein Ladefehler steht an der Stelle der Tabelle, nie als „Keine Einträge
  // gefunden“; „Weitere Einträge laden“ ist eine Aktion und meldet als Toast
  // (#2514).
  const { error: loadError } = useSwrResourceLoadError(
    [firstPage],
    "das Änderungsprotokoll",
    () => firstPage.mutate(),
  );
  const { show: showMoreError } = useApiErrorDisplay();
  // Nachgeladene Seiten gehören zu genau einer ersten Seite: ein Filterwechsel
  // oder ein neuer Stand der ersten Seite verwirft sie.
  const [more, setMore] = useState<{
    base: AuditLogPage;
    events: AuditLogEvent[];
    nextCursor: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const base = firstPage.data;
  const appended = more && more.base === base ? more : null;
  const events = useMemo(
    () => [...(base?.events ?? []), ...(appended?.events ?? [])],
    [base, appended],
  );
  const nextCursor = appended
    ? appended.nextCursor
    : (base?.nextCursor ?? null);
  const retentionCutoff = base?.retentionCutoff ?? "";
  // „Wiederholen“ lädt ab dem aktuellen Stand weiter.
  const loadMoreRef = useRef<() => void>(() => undefined);

  const loadMore = useCallback(() => {
    if (!base || !nextCursor) return;
    setLoadingMore(true);
    staffAuditLogService
      .getAuditLog({ ...query, cursor: nextCursor })
      .then((page) => {
        setMore((prev) => ({
          base,
          events: [
            ...(prev && prev.base === base ? prev.events : []),
            ...page.events,
          ],
          nextCursor: page.nextCursor,
        }));
      })
      .catch((err: unknown) => {
        log.error("failed to load more audit log entries", {
          error: err instanceof Error ? err.message : String(err),
        });
        void showMoreError(err, {
          object: "die nächste Seite des Änderungsprotokolls",
          retry: () => loadMoreRef.current(),
        });
      })
      .finally(() => setLoadingMore(false));
  }, [base, nextCursor, query, showMoreError]);
  useLayoutEffect(() => {
    loadMoreRef.current = loadMore;
  });
  const isLoading = (!base && !loadError) || loadingMore;

  const columns: DataTableColumn<AuditLogEvent>[] = useMemo(
    () => [
      {
        key: "occurredAt",
        header: "Zeitpunkt",
        stacked: "meta",
        // School time, whatever the viewer's zone (#6293).
        render: (row) =>
          `${formatBerlinDate(row.occurredAt)}, ${berlinClockFromISO(row.occurredAt)}`,
        className: "whitespace-nowrap text-gray-600",
      },
      {
        key: "staff",
        header: "Mitarbeiter:in",
        stacked: "title",
        render: staffLabel,
      },
      {
        key: "source",
        header: "Bereich",
        render: (row) => (
          <StatusBadge
            label={auditLogSourceLabels[row.source]}
            tone="gray"
            compact
          />
        ),
      },
      {
        key: "detail",
        header: "Änderung",
        render: (row) => describeEvent(row),
      },
      {
        key: "actor",
        header: "Bearbeitet von",
        render: (row) => actorLabel(row),
        className: "whitespace-nowrap",
      },
      {
        key: "reason",
        header: "Begründung",
        render: (row) =>
          row.reason ? (
            <span className="text-gray-600 italic">{row.reason}</span>
          ) : (
            <span className="text-gray-500">–</span>
          ),
      },
    ],
    [],
  );

  const staffSelectOptions = useMemo(
    () => [
      { value: "all", label: "Alle Mitarbeitenden" },
      ...staffOptions.map((s) => ({ value: s.id, label: s.name })),
    ],
    [staffOptions],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <CustomSelect
            id="audit-staff"
            label="Mitarbeiter:in"
            value={staffId}
            options={staffSelectOptions}
            onChange={setStaffId}
          />
        </div>
        <div className="w-56">
          <CustomSelect
            id="audit-actor"
            label="Bearbeitet von"
            value={actorId}
            options={staffSelectOptions}
            onChange={setActorId}
          />
        </div>
        <div className="w-48">
          <CustomSelect
            id="audit-source"
            label="Bereich"
            value={source}
            options={sourceOptions}
            onChange={setSource}
          />
        </div>
        <div>
          <ISODatePicker
            id="audit-from"
            label="Von"
            value={from}
            onChange={setFrom}
            max={to || undefined}
            calendarLayout="popover"
            controlSize="compact"
            className="w-44"
          />
        </div>
        <div>
          <ISODatePicker
            id="audit-to"
            label="Bis"
            value={to}
            onChange={setTo}
            min={from || undefined}
            calendarLayout="popover"
            controlSize="compact"
            className="w-44"
          />
        </div>
      </div>

      {retentionCutoff && from && from < retentionCutoff && (
        <Alert
          type="info"
          message={`Einträge zur Zeiterfassung vor dem ${formatDate(retentionCutoff)} wurden gemäß Aufbewahrungsfrist gelöscht. Buchungen und Monatsabschlüsse bleiben vollständig.`}
        />
      )}

      {loadError ? (
        <LoadErrorAlert error={loadError} />
      ) : (
        <DataTable
          columns={columns}
          rows={events}
          getRowKey={(row) => `${row.source}:${row.entryId}`}
          isLoading={isLoading && events.length === 0}
          emptyState={
            <EmptyState
              title="Keine Einträge gefunden"
              description="Zeitraum erweitern oder Filter zurücksetzen."
            />
          }
        />
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            type="button"
            size="md"
            variant="outline"
            onClick={loadMore}
            disabled={isLoading}
            tooltip="Hängt ältere Einträge des Protokolls unten an die Liste an."
          >
            Weitere Einträge laden
          </Button>
        </div>
      )}
    </div>
  );
}
