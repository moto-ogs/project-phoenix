"use client";

// Kindakte im iPad-Querformat (#8070): links ⅓ die Kinderliste, rechts ⅔ die
// Akte. Ein Tipp auf ein anderes Kind tauscht die Akte, ohne die Liste zu
// verlassen; Zurück führt weiter dorthin, woher die Akte geöffnet wurde.
// Unter `split:` (Telefon, iPad hoch, Desktop) rendert der Rahmen nur die
// Akte, unverändert.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Avatar } from "~/components/ui/avatar";
import {
  Collection,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { SearchBar } from "~/components/ui/page-header/SearchBar";
import { Z_LAYER } from "~/components/ui/overlay-styles";
import { SplitView } from "~/components/ui/split-view";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  CHILD_DAY_TONE_BADGE,
  childDayStatus,
} from "~/components/students/child-day-status";
import { useDeviceContext } from "~/lib/device-context";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useSWRAuth } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";
import {
  buildStudentSearchFilters,
  fetchStudentSearch,
} from "~/lib/student-search-resource";
import type { Student } from "~/lib/student-helpers";
import { useTenantRouter } from "~/lib/tenant-router";

function studentName(student: Student): string {
  return (
    `${student.first_name ?? ""} ${student.second_name ?? ""}`.trim() ||
    student.name
  );
}

export function StudentSplitFrame({
  studentId,
  from,
  children,
}: Readonly<{
  studentId: string;
  /** Rückweg der Akte (`?from=`), bleibt beim Wechsel des Kindes erhalten. */
  from: string | null;
  children: ReactNode;
}>) {
  const { resolved, isSplit } = useDeviceContext();
  if (!resolved || !isSplit) return <>{children}</>;
  return (
    <SplitView
      list={<SplitStudentList studentId={studentId} from={from} />}
      detail={children}
      empty={null}
    />
  );
}

function SplitStudentList({
  studentId,
  from,
}: Readonly<{ studentId: string; from: string | null }>) {
  const router = useTenantRouter();
  const today = berlinTodayISO();
  const params = {
    search: "",
    groupIds: [],
    schoolClasses: [],
    years: [],
    roomId: "",
    dayStatus: "all" as const,
    date: today,
    isToday: true,
    bus: "all" as const,
    photoConsent: "all" as const,
    pickupStatus: "all" as const,
    companions: false,
  };
  const { data } = useSWRAuth(
    studentKeys.search({ ...params, photoState: "split" }),
    () => fetchStudentSearch(buildStudentSearchFilters(params), today, true),
    { keepPreviousData: true },
  );
  const students = useMemo(
    () =>
      [...(data?.students ?? [])].sort((a, b) =>
        (a.second_name ?? a.name).localeCompare(b.second_name ?? b.name, "de"),
      ),
    [data],
  );
  // Eigene Suche der Spalte: Ein anderes Kind ist zwei Buchstaben entfernt,
  // ohne zurück zur Kindersuche zu gehen.
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    if (!needle) return students;
    return students.filter((student) =>
      studentName(student).toLocaleLowerCase("de").includes(needle),
    );
  }, [students, query]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      "[aria-current='true'],[data-selected='true']",
    );
    row?.scrollIntoView({ block: "center" });
  }, [studentId, students.length]);

  const fromQuery = from ? `?from=${encodeURIComponent(from)}` : "";
  return (
    <div ref={listRef}>
      <Collection label="Kinder">
        {/* Kopf der Spalte: klebt oben in ihrem eigenen Scroll. */}
        <div
          className={`sticky top-0 ${Z_LAYER.sticky} border-b border-gray-100 bg-white p-2`}
        >
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Kind suchen…"
            size="sm"
          />
        </div>
        <CollectionList>
          {shown.map((student) => {
            const id = student.id.toString();
            const status = childDayStatus(student, true);
            const klass = student.school_class?.replace(/^Klasse\s+/, "");
            const subtitle = [klass, student.group_name]
              .filter(Boolean)
              .join(" · ");
            return (
              <CollectionRow
                key={id}
                leading={
                  <Avatar
                    imageUrl={student.photo_url ?? null}
                    name={studentName(student)}
                    size="sm"
                    decorative
                  />
                }
                // Dieselbe Zeile wie in der Kindersuche: Status hinter dem
                // Namen, Klasse und Gruppe darunter.
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{studentName(student)}</span>
                    <span className="shrink-0">
                      <StatusBadge
                        label={status.value}
                        tone={CHILD_DAY_TONE_BADGE[status.tone]}
                        compact
                      />
                    </span>
                  </span>
                }
                subtitle={subtitle || undefined}
                selected={id === studentId}
                onClick={() => router.replace(`/students/${id}${fromQuery}`)}
              />
            );
          })}
        </CollectionList>
      </Collection>
    </div>
  );
}
