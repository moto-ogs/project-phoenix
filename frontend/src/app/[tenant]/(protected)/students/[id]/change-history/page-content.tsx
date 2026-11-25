"use client";

import type { changeHistoryEntry } from "~/lib/contract/students.generated";
import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  resolveStudentReferrer,
  studentHistoryBack,
} from "../student-referrer";
import { ApiError } from "~/lib/api-error";
import { fetchStudentChangeHistory } from "~/lib/student-api";
import { useConfirmedSWR } from "~/lib/hooks/use-confirmed-resource";
import { studentKeys } from "~/lib/swr/portal-keys";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useStudentHistoryBreadcrumb } from "~/lib/breadcrumb-context";
import { useScrollToTop } from "~/lib/hooks/use-scroll-to-top";
import { formatDate, formatTime } from "~/lib/date-helpers";
import { ChangeHistorySkeleton } from "./page-skeleton";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";

const CHANGE_HISTORY_INFO =
  "Hier siehst du, wer wann welche Angaben zu diesem Kind geändert hat. Ändern kannst du hier nichts.";

// ─── Types ───────────────────────────────────────────────────────────────────

// German labels for the tracked fields. The backend stores the raw field token
// and already-formatted German values; only the field name is mapped here.
const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  supervisor_notes: "Betreuer-Notizen",
  extra_info: "Zusatzinformationen",
  health_info: "Gesundheitsinformationen",
  pickup_status: "Abholung",
  pickup_schedule: "Dauerhafte Gehzeiten",
  departure_days: "Wochenplan (Abholung)",
  departure_companion_note: "Geht außerdem mit",
  // Krank oder entschuldigt, von der Schulverwaltung in moto schule
  // nachgetragen (#4791).
  school_absence_report: "Meldung der Schulverwaltung",
  // Stopp von Raumverlauf und Stimmung für das Kind (#3844).
  room_history_stop: "Raumverlauf und Stimmung",
  document: "Dokument",
};

// Document rows carry their category in the field name ("document_attest") so
// the backend can filter the history by the same per-category permissions the
// Dokumente tab uses. The readable category is already part of the value, so
// every variant renders under one label.
function fieldLabel(field: string): string {
  if (field.startsWith("document_")) {
    return "Dokument";
  }
  return FIELD_LABELS[field] ?? field;
}

// ─── Value cell ──────────────────────────────────────────────────────────────

function ValueText({ value }: { readonly value: string }) {
  if (value.trim() === "") {
    return <span className="text-gray-500 italic">leer</span>;
  }
  return <span className="break-words whitespace-pre-wrap">{value}</span>;
}

// ─── Table ───────────────────────────────────────────────────────────────────

const CHANGE_COLUMNS: DataTableColumn<changeHistoryEntry>[] = [
  {
    key: "changedAt",
    header: "Zeitpunkt",
    className: "whitespace-nowrap tabular-nums",
    stacked: "meta",
    render: (entry) => (
      <span className="text-gray-600">
        {formatDate(entry.changed_at)}
        <span className="ml-1 text-gray-500">
          {formatTime(entry.changed_at)}
        </span>
      </span>
    ),
  },
  {
    key: "editedBy",
    header: "Geändert von",
    className: "whitespace-nowrap font-medium",
    render: (entry) => entry.edited_by,
  },
  {
    key: "field",
    header: "Feld",
    className: "whitespace-nowrap",
    stacked: "title",
    render: (entry) => (
      <span className="text-gray-700">{fieldLabel(entry.field)}</span>
    ),
  },
  {
    key: "old",
    header: "Vorher",
    className: "max-w-xs",
    render: (entry) => (
      <span className="text-gray-500">
        <ValueText value={entry.old_value} />
      </span>
    ),
  },
  {
    key: "new",
    header: "Nachher",
    className: "max-w-xs",
    render: (entry) => (
      <span className="text-gray-700">
        <ValueText value={entry.new_value} />
      </span>
    ),
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StudentChangeHistoryPage() {
  return (
    <Suspense fallback={<ChangeHistorySkeleton />}>
      <StudentChangeHistoryPageContent />
    </Suspense>
  );
}

function StudentChangeHistoryPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const studentId = params.id as string;
  const referrer = resolveStudentReferrer(searchParams.get("from"));

  // Dieselbe Kindakte wie die Akte selbst (studentKeys.detail): die
  // Unterseite fragt das Kind nicht noch einmal ab. Der Name schmückt nur den
  // Kopf; ohne ihn zeigt die Seite den Verlauf unter dem allgemeinen Titel.
  const { student, loading: studentLoading } = useStudentData(studentId);
  const {
    data: entries,
    failure: historyError,
    mutate,
  } = useConfirmedSWR(studentKeys.changeHistory(studentId), () =>
    fetchStudentChangeHistory(studentId),
  );
  // A 404 is its own state, not an error to retry.
  const notFound =
    historyError instanceof ApiError && historyError.status === 404;
  const historyLoad = useSwrResourceLoadError(
    [
      {
        data: entries ?? undefined,
        error: notFound ? undefined : historyError,
      },
    ],
    "die Liste der Änderungen",
    () => mutate(),
  );
  const loading =
    (!entries && !historyError) ||
    studentLoading ||
    (historyLoad.failure !== undefined && historyLoad.error === null);

  useStudentHistoryBreadcrumb({ studentName: student?.name, referrer });
  useScrollToTop(studentId);

  const displayName = student
    ? (student.name ?? `${student.first_name} ${student.second_name}`)
    : "";
  // Statuszeile: Klasse, Gruppe und die Zahl der geladenen Einträge. Beides
  // steht schon im Datensatz der Seite, es entsteht kein weiterer Request.
  // Ohne geladene Einträge steht keine "0 Einträge" neben dem Ladefehler
  // (#2517).
  const entryCount = entries?.length ?? 0;
  const entryStat = entries
    ? { value: entryCount, label: entryCount === 1 ? "Eintrag" : "Einträge" }
    : null;
  const entryLine = entryStat ? `${entryStat.value} ${entryStat.label}` : null;
  const studentFacts = student
    ? [student.school_class, student.group_name].filter(
        (part): part is string => Boolean(part),
      )
    : [];
  const studentMeta =
    studentFacts.length + (entryStat ? 1 : 0) > 1 ? (
      <TenantPageStats
        items={[
          ...studentFacts.map((label) => ({ label })),
          ...(entryStat ? [entryStat] : []),
        ]}
      />
    ) : (
      (studentFacts[0] ?? null)
    );
  const failed = notFound || historyLoad.failure !== undefined;
  const back = studentHistoryBack(studentId, referrer, failed);

  return (
    <>
      {/* Der Entitätskopf ist die Kopfkarte der Seite. */}
      <TenantPage
        back
        {...back}
        leading={<ConceptIconTile concept={changeHistoryConcept} size="page" />}
        title={displayName || "Änderungsverlauf"}
        info={CHANGE_HISTORY_INFO}
        stats={studentMeta ?? entryLine}
        statsLoading={loading}
        loading={loading}
        error={notFound ? "Kind nicht gefunden." : historyLoad.error}
        empty={
          !loading && !failed && entryCount === 0
            ? {
                title: "Noch keine Änderungen erfasst.",
                description:
                  "Sobald jemand Angaben zu diesem Kind ändert, erscheint der Eintrag hier.",
              }
            : null
        }
      >
        <SectionCard
          title="Änderungsverlauf"
          description="Wer hat wann welche Angaben zu diesem Kind geändert"
          concept={changeHistoryConcept}
        >
          <DataTable
            columns={CHANGE_COLUMNS}
            rows={entries ?? []}
            getRowKey={(entry) => entry.id}
          />
        </SectionCard>
      </TenantPage>
    </>
  );
}
