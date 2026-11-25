"use client";

// „Heute anders“ in moto schule (#7670): was heute für die eigenen Klassen
// und die ganze Schule anders ist, oben auf der Startseite. Unterrichtsschluss
// und Schließtag kommen aus der Übersicht des Backends, seit #8148 auch die
// Vertretungen bei den eigenen Aufsichten. Die Kinder stehen im
// Klassentag; der Block zählt sie nur pro Klasse aus dem Bericht, den die
// Startseite ohnehin lädt, und springt zur ersten geänderten Zeile.

import { useSession } from "next-auth/react";
import { useCallback, useId } from "react";
import type { ReactNode } from "react";

import { classDayPath } from "~/components/class-day/routes";
import { useClassDayRefresh } from "~/components/class-day/use-class-day-refresh";
import { DAY_CHANGE_ANCHOR } from "~/components/class-day/use-jump-to-day-change";
import {
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
} from "~/components/home/day-changes-text";
import { Alert } from "~/components/ui/alert";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListRow } from "~/components/ui/list-row";
import NavigationLink from "~/components/ui/navigation-link";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { hasPermission } from "~/lib/auth-utils";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import type * as schoolClassDayContract from "~/lib/contract/school-class-day.generated";
import {
  fetchSchoolDayChanges,
  type DayChange,
  type DayChangesOverview,
} from "~/lib/day-changes";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { schoolClassLabel } from "~/lib/school-class-label";
import { schoolPath } from "~/lib/school-url";
import { useSWRAuth } from "~/lib/swr";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";

const NOTICES_ROUTE = "/school/tagesinformationen";

/** Der Weg eines Eintrags in moto schule, ohne Ziel null. */
function schoolHref(entry: DayChange, today: string): string | null {
  switch (entry.link?.target) {
    case "school_class":
      return entry.schoolClass
        ? schoolPath(classDayPath(entry.schoolClass.name, today))
        : null;
    case "school_calendar":
      return schoolPath("/school/kalender");
    case "school_supervisions":
      return schoolPath("/school/aufsichten");
    default:
      return null;
  }
}

function childChangesText(klass: string, count: number): string {
  // Derselbe Wortlaut wie auf der Karte der Klasse darunter.
  const children =
    count === 1
      ? "1 Kind anders als sonst"
      : `${count} Kinder anders als sonst`;
  return `${schoolClassLabel(klass)}: ${children}`;
}

export interface SchoolDayChangesBlockProps {
  /** Der in der Klassenübersicht ausgewählte Tag. */
  readonly selectedDate: string;
  /** Der Bericht der eigenen Klassen, wie ihn die Startseite lädt. */
  readonly fetchAssignedClasses: (
    date: string,
  ) => Promise<schoolClassDayContract.AssignedClassesReport>;
}

export function SchoolDayChangesBlock({
  selectedDate,
  fetchAssignedClasses,
}: SchoolDayChangesBlockProps) {
  const { data: session } = useSession();
  const today = useBerlinToday();
  const isToday = selectedDate === today;
  // Wer alle Klassen sieht (Schulverwaltung), hat die Zahlen der ganzen
  // Schule direkt darunter; der Block zählt nur eigene Klassen.
  const ownClassesOnly = !hasPermission(session, "class_day:all_classes");
  const changes = useSWRAuth<DayChangesOverview>(
    session && isToday ? schoolPortalKeys.dayChanges(today) : null,
    fetchSchoolDayChanges,
    { revalidateOnFocus: true },
  );
  // Derselbe Schlüssel wie die Klassenübersicht: an heute liest die Seite
  // den Bericht nur einmal.
  const classes = useSWRAuth(
    session && ownClassesOnly && isToday
      ? schoolPortalKeys.assignedClasses(today)
      : null,
    () => fetchAssignedClasses(today),
    { revalidateOnFocus: true },
  );
  const { mutate: reloadChanges } = changes;
  const { mutate: reloadClasses } = classes;
  // Eine Krankmeldung oder ein anderer Status an dieser Schule (#4792).
  useClassDayRefresh(
    useCallback(() => {
      if (!isToday) return;
      void reloadChanges();
      void reloadClasses();
    }, [isToday, reloadChanges, reloadClasses]),
  );
  const loadError = useSwrLoadError(
    changes.error,
    "die Übersicht „Heute anders“",
    () => reloadChanges(),
  );
  if (!isToday) return null;

  const overview = changes.data;
  const classLines = (classes.data?.classes ?? []).filter(
    (klass) => classes.data?.school_day && klass.changes > 0,
  );
  const classesFailed = ownClassesOnly && Boolean(classes.error);
  const loading =
    !overview || (ownClassesOnly && !classes.data && !classes.error);
  const own = overview?.entries.filter((e) => e.section === "you") ?? [];
  const school = overview?.entries.filter((e) => e.section !== "you") ?? [];
  const failed = overview?.failedSources ?? [];
  const noVisibleChanges =
    own.length === 0 &&
    school.length === 0 &&
    classLines.length === 0 &&
    failed.length === 0 &&
    !classesFailed;
  // Ohne Schulkalender bleiben Schließtage absichtlich unsichtbar. Deshalb
  // wäre eine Entwarnung über den ganzen Tag hier falsch.
  const canReassure = hasPermission(session, "calendar:school");
  if (!canReassure && overview && !loading && noVisibleChanges) return null;

  return (
    <SectionCard
      title="Heute anders"
      concept={dayChangesConcept}
      testId="school-day-changes"
      loading={loading && !loadError}
      action={
        <NavigationLink
          href={schoolPath(NOTICES_ROUTE)}
          className="text-sm font-medium text-gray-700 underline-offset-4 hover:underline"
        >
          Hinweise der Leitung
        </NavigationLink>
      }
    >
      <div aria-live="polite" className="space-y-4">
        <LoadErrorAlert error={loadError} />
        {failed.map((source) => (
          <Alert
            key={source}
            type="warning"
            message={sourceFailureText(source)}
          />
        ))}
        {classesFailed ? (
          <Alert
            type="warning"
            message="Die Kinder deiner Klassen konnten gerade nicht geladen werden."
          />
        ) : null}
        {overview && !loading && canReassure && noVisibleChanges ? (
          <p className="text-sm text-gray-600">
            Heute läuft alles wie geplant.
          </p>
        ) : null}
        {own.length > 0 || classLines.length > 0 ? (
          <DayChangeList title="Betrifft dich">
            {own.map((entry, i) => (
              <EntryRow key={`you-${i}`} entry={entry} today={today} />
            ))}
            {classLines.map((klass) => (
              <li key={klass.school_class}>
                <ListRow
                  density="compact"
                  href={`${schoolPath(classDayPath(klass.school_class, today))}#${DAY_CHANGE_ANCHOR}`}
                >
                  <span className="text-sm text-gray-900">
                    {childChangesText(klass.school_class, klass.changes)}
                  </span>
                </ListRow>
              </li>
            ))}
          </DayChangeList>
        ) : null}
        {school.length > 0 ? (
          <DayChangeList title="Schule">
            {school.map((entry, i) => (
              <EntryRow key={`school-${i}`} entry={entry} today={today} />
            ))}
          </DayChangeList>
        ) : null}
      </div>
    </SectionCard>
  );
}

function DayChangeList({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <SectionLabel id={headingId} as="h3" className="mb-2">
        {title}
      </SectionLabel>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function EntryRow({
  entry,
  today,
}: {
  readonly entry: DayChange;
  readonly today: string;
}) {
  const text = dayChangeText(entry);
  if (!text) return null;
  const span = dayChangeSpan(entry);
  const href = schoolHref(entry, today);
  const body = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm text-gray-900">{text}</span>
      {span ? (
        <span className="block text-xs text-gray-500">{span}</span>
      ) : null}
    </span>
  );
  return (
    <li>
      {href ? (
        <ListRow href={href} density="compact">
          {body}
        </ListRow>
      ) : (
        <ListRow density="compact">{body}</ListRow>
      )}
    </li>
  );
}
