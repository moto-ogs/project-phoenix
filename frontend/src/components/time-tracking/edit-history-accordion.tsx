"use client";

import { SquarePen } from "lucide-react";

import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import type { WorkSessionEdit } from "~/lib/time-tracking-helpers";
import { formatTime } from "~/lib/time-tracking-helpers";
import {
  berlinClockFromISO,
  formatBerlinDate,
  formatDate,
  isValidISODate,
} from "~/lib/date-helpers";
import { SpinnerIcon } from "~/components/ui/icons";

// Renders the audit trail for a single work session. Used by both the
// MA self-service /time-tracking page and the admin staff detail view —
// the underlying audit data (audit.work_session_edits) is identical, so
// the UI is too.
//
// Lifting this out of /time-tracking/page.tsx serves two goals:
//   1. DSGVO Art. 15 / "Mitarbeiter sieht eigene Daten" was already
//      covered there. The admin side needs the same view to answer
//      auskunft requests and audit lohn corrections.
//   2. Keeping a single source of truth for the field labels and value
//      formatting — diverging copies between MA and admin would be a
//      future incident waiting to happen.

// Exported for the cross-staff audit log (#1417) — one source of truth for
// field labels and value formatting, per the note above.
function isCreated(edit: WorkSessionEdit): boolean {
  return edit.oldValue === null || edit.oldValue === "";
}

/** „23.11.2026, 07:52–16:35, Pause 38 min, In der OGS“ */
function createdSummary(edits: readonly WorkSessionEdit[]): string {
  const value = (field: string) => {
    const edit = edits.find((e) => e.fieldName === field);
    return edit ? formatEditValue(field, edit.newValue) : null;
  };
  const start = value("check_in_time");
  const end = value("check_out_time");
  const shown = new Set(["date", "check_in_time", "check_out_time"]);
  const parts = [
    value("date"),
    start && end ? `${start}–${end}` : (start ?? end),
    ...edits
      .filter((e) => !shown.has(e.fieldName))
      .map((e) => {
        const text = formatEditValue(e.fieldName, e.newValue);
        return e.fieldName === "break_minutes" ||
          e.fieldName === "break_duration"
          ? `Pause ${text}`
          : text;
      }),
  ];
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

export const FIELD_LABELS: Record<string, string> = {
  check_in_time: "Start",
  check_out_time: "Ende",
  break_minutes: "Pause",
  break_duration: "Pausendauer",
  status: "Ort",
  notes: "Notiz",
  // Beim Anlegen eines Eintrags speichert das Backend auch seinen Tag; ohne
  // Beschriftung stand dort der Feldname „date“.
  date: "Datum",
  // Deviation from the planned shift (#1844): old = geplante, new = tatsächliche
  // Zeit (both "HH:MM"), the reason lands in the Grund column. So the row reads
  // "Abweichung | 08:00 → 07:30 | Grund: …" — plan, actual and reason together.
  deviation_reason: "Abweichung",
};

export function formatEditValue(
  fieldName: string,
  value: string | null,
): string {
  if (value === null || value === "") return "–";
  if (fieldName === "check_in_time" || fieldName === "check_out_time") {
    return formatTime(value);
  }
  if (fieldName === "break_minutes" || fieldName === "break_duration") {
    return `${value} min`;
  }
  if (fieldName === "status") {
    return value === "home_office" ? "Unterwegs" : "In der OGS";
  }
  // Ein Kalendertag als „23.11.2026“, nie als „2026-11-23“.
  if (fieldName === "date" && isValidISODate(value.slice(0, 10))) {
    return formatDate(value.slice(0, 10));
  }
  return value;
}

interface EditRow {
  readonly edit: WorkSessionEdit;
  // Datum, Person und Grund stehen je Speichervorgang nur in der ersten Zeile.
  readonly firstOfSave: boolean;
  readonly dateStr: string;
  readonly editorLabel: string;
  readonly notes: string | null | undefined;
}

function fieldLabel(edit: WorkSessionEdit): string {
  return FIELD_LABELS[edit.fieldName] ?? edit.fieldName;
}

function OldValue({ edit }: Readonly<{ edit: WorkSessionEdit }>) {
  return (
    <span className="text-moto-red line-through">
      {formatEditValue(edit.fieldName, edit.oldValue)}
    </span>
  );
}

function NewValue({ edit }: Readonly<{ edit: WorkSessionEdit }>) {
  return (
    <span className="text-moto-green-strong font-medium">
      {formatEditValue(edit.fieldName, edit.newValue)}
    </span>
  );
}

// On a phone each change is a card of the table (#7915): the field with
// "vorher → nachher" heads it, date and author of the save beside and below.
// The two value columns stand in that head, so they carry no line of their own.
const EDIT_COLUMNS: DataTableColumn<EditRow>[] = [
  {
    key: "date",
    header: "Datum",
    className: "whitespace-nowrap",
    stacked: "meta",
    render: (row) =>
      row.firstOfSave ? (
        <span className="text-gray-500">{row.dateStr}</span>
      ) : null,
    // On a phone every card of a save carries its date: without the table's
    // rows beside each other, the date ties the cards of one save together.
    stackedRender: (row) => (
      <span className="text-gray-500">{row.dateStr}</span>
    ),
  },
  {
    key: "editor",
    header: "Von",
    className: "whitespace-nowrap",
    render: (row) =>
      row.firstOfSave ? (
        <span className="text-gray-600">{row.editorLabel}</span>
      ) : null,
  },
  {
    key: "field",
    header: "Feld",
    className: "whitespace-nowrap",
    stacked: "title",
    render: (row) => (
      <span className="text-gray-600">{fieldLabel(row.edit)}</span>
    ),
    stackedRender: (row) => (
      <span className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-gray-600">{fieldLabel(row.edit)}</span>
        <OldValue edit={row.edit} />
        <span className="text-gray-500" aria-hidden="true">
          →
        </span>
        <span className="sr-only">geändert zu</span>
        <NewValue edit={row.edit} />
      </span>
    ),
  },
  {
    key: "old",
    header: "Vorher",
    className: "whitespace-nowrap",
    stacked: "hidden",
    render: (row) => <OldValue edit={row.edit} />,
  },
  {
    key: "new",
    header: "Nachher",
    className: "whitespace-nowrap",
    stacked: "hidden",
    render: (row) => <NewValue edit={row.edit} />,
  },
  {
    key: "reason",
    header: "Grund",
    render: (row) => {
      if (!row.firstOfSave) return null;
      return row.notes ? (
        <span className="text-gray-500 italic">&ldquo;{row.notes}&rdquo;</span>
      ) : (
        "–"
      );
    },
  },
];

export function EditHistoryAccordion({
  edits,
  isLoading,
  onEdit,
  plain = false,
}: {
  readonly edits: WorkSessionEdit[];
  readonly isLoading: boolean;
  readonly onEdit?: () => void;
  /**
   * App (#8070): im Blatt eine schlichte Liste mit Trennlinien statt
   * umrandeter Kästen; eine Karte im Blatt las sich wie ein zweites Blatt.
   */
  readonly plain?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-3">
        <SpinnerIcon className="h-4 w-4 text-gray-400" />
        <span className="ml-2 text-xs text-gray-500">Laden...</span>
      </div>
    );
  }

  if (edits.length === 0) {
    return <EmptyState variant="compact" title="Keine Änderungen vorhanden" />;
  }

  // Group edits by createdAt timestamp — edits from the same save action
  // share the same timestamp; date, author and reason stand once per save.
  const grouped = new Map<string, WorkSessionEdit[]>();
  for (const edit of edits) {
    const key = edit.createdAt;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(edit);
    } else {
      grouped.set(key, [edit]);
    }
  }

  const rows = Array.from(grouped.entries()).map(([timestamp, group]) => {
    // When the change was saved, as school time (#6293).
    const dateStr = `${formatBerlinDate(timestamp)}, ${berlinClockFromISO(timestamp)}`;
    const fieldEdits = group.filter((e) => e.fieldName !== "notes");
    const notes = group[0]?.notes;
    // All edits in a group share the same author — they came from one save
    // action — so we read editor info from the first.
    const isSelfEdit = group[0]?.isSelfEdit ?? true;
    const editorName = group[0]?.editorName ?? "";
    const editorLabel = isSelfEdit
      ? editorName
        ? `${editorName} (selbst)`
        : "Selbst"
      : editorName
        ? `${editorName} (Admin)`
        : "Admin";
    return { timestamp, dateStr, fieldEdits, notes, editorLabel };
  });

  return (
    <div>
      {/* App (#8070): im Blatt eine schlichte Liste mit Trennlinien statt
          der gestapelten Tabelle; eine Karte im Blatt las sich wie ein
          zweites Blatt. */}
      {plain ? (
        <div className="divide-y divide-gray-100 [&>*]:py-2 [&>*:first-child]:pt-0">
          {rows.map(
            ({ timestamp, dateStr, fieldEdits, notes, editorLabel }) => (
              <div key={timestamp}>
                <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500">
                  <span>{dateStr}</span>
                  <span className="font-medium">{editorLabel}</span>
                </div>
                {/* Runde 19: Ein neu angelegter Eintrag liest sich als ein
                  Satz („Angelegt: 23.11.2026, 07:52–16:35, …“) statt als
                  Liste von „neu → …“. */}
                {fieldEdits.length > 0 && fieldEdits.every(isCreated) ? (
                  <p className="text-xs text-gray-700">
                    <span className="text-gray-500">Angelegt: </span>
                    {createdSummary(fieldEdits)}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {fieldEdits.map((edit) => (
                      <div
                        key={edit.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="w-12 shrink-0 text-gray-500">
                          {FIELD_LABELS[edit.fieldName] ?? edit.fieldName}
                        </span>
                        {/* Ohne alten Wert wurde das Feld neu angelegt: kein rot
                        durchgestrichener Strich, der wie ein Fehler aussieht. */}
                        {edit.oldValue === null || edit.oldValue === "" ? (
                          <span className="text-gray-500">neu</span>
                        ) : (
                          <span className="text-moto-red line-through">
                            {formatEditValue(edit.fieldName, edit.oldValue)}
                          </span>
                        )}
                        <span className="text-gray-500">→</span>
                        <span className="text-moto-green-strong font-medium">
                          {formatEditValue(edit.fieldName, edit.newValue)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {notes && (
                  <p className="mt-1.5 text-xs text-gray-500 italic">
                    &ldquo;{notes}&rdquo;
                  </p>
                )}
              </div>
            ),
          )}
        </div>
      ) : (
        <DataTable
          columns={EDIT_COLUMNS}
          rows={rows.flatMap(({ dateStr, fieldEdits, notes, editorLabel }) =>
            fieldEdits.map((edit, index) => ({
              edit,
              firstOfSave: index === 0,
              dateStr,
              editorLabel,
              notes,
            })),
          )}
          getRowKey={(row) => row.edit.id}
          dense
        />
      )}
      {onEdit && (
        <Button
          type="button"
          variant="dashed"
          size="compact"
          onClick={onEdit}
          className="mt-2 w-full"
          tooltip="Öffnet den Tag zum Korrigieren, jede Änderung erscheint in diesem Verlauf."
        >
          <SquarePen className="h-3.5 w-3.5" />
          Weitere Änderung vornehmen
        </Button>
      )}
    </div>
  );
}
