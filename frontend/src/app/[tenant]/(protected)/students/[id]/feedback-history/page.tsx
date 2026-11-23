"use client";
import { StatusBadge } from "~/components/ui/status-badge";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

import { Suspense, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "next-auth/react";
import {
  getStartDateForTimeRange,
  toISODate,
  berlinTodayISO,
  berlinDateTimeISO,
  parseISODate,
} from "~/lib/date-helpers";
import { useStudentHistoryBreadcrumb } from "~/lib/breadcrumb-context";
import { useScrollToTop } from "~/lib/hooks/use-scroll-to-top";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  resolveStudentReferrer,
  studentHistoryBack,
} from "../student-referrer";
import { ApiError } from "~/lib/api-error";
import { FeedbackHistorySkeleton } from "./page-skeleton";
import { useConfirmedSWR } from "~/lib/hooks/use-confirmed-resource";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { fetchStudentFeedback, type FeedbackEntry } from "~/lib/feedback-api";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import { feedbackConcept } from "~/lib/concepts/feedback";
import { PlanLegend } from "~/components/ui/planning/plan-legend";
import { ListGroupHeader } from "~/components/ui/list-group-header";

const FEEDBACK_INFO =
  "Hier siehst du, wie dieses Kind seine Tage bewertet hat. Das Feedback gibt das Kind freiwillig nach dem Abmelden am Tablet. Wähle oben den Zeitraum.";

const FEATURE_DISABLED_DESCRIPTION =
  "Die Feedbackhistorie ist für deine Schule ausgeschaltet. Sie lässt sich in den Einstellungen unter Datenschutz einschalten.";

const FEEDBACK_HISTORY_DESCRIPTION =
  "Rückmeldungen dieses Kindes im Zeitverlauf.";

const feedbackTypeLabels: Record<FeedbackEntry["feedbackType"], string> = {
  positive: "Positives Feedback",
  neutral: "Neutrales Feedback",
  negative: "Negatives Feedback",
};

const FeedbackHistoryChart = dynamic(() => import("./feedback-history-chart"), {
  ssr: false,
  loading: () => (
    <Skeleton className="h-[180px] w-full sm:h-[220px]" aria-hidden />
  ),
});

const feedbackToneColors = {
  positive: MOTO_COLOR_PALETTE.green.base,
  neutral: MOTO_COLOR_PALETTE.amber.base,
  negative: MOTO_COLOR_PALETTE.red.base,
} satisfies Record<FeedbackEntry["feedbackType"], string>;

const timeRangeOptions = [
  { value: "all", label: "Alle" },
  { value: "today", label: "Heute" },
  { value: "week", label: "Diese Woche" },
  { value: "7days", label: "Letzte 7 Tage" },
  { value: "month", label: "Diesen Monat" },
] as const;

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
  });
}

export default function StudentFeedbackHistoryPage() {
  return (
    <Suspense fallback={<FeedbackHistorySkeleton />}>
      <StudentFeedbackHistoryPageContent />
    </Suspense>
  );
}

function StudentFeedbackHistoryPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const studentId = params.id as string;
  const referrer = resolveStudentReferrer(searchParams.get("from"));
  useSession();

  // Dieselbe Kindakte wie die Akte selbst (studentKeys.detail).
  const {
    student,
    loading: studentLoading,
    error: studentError,
    refreshData,
  } = useStudentData(studentId);
  const {
    data: feedbackData,
    failure: feedbackError,
    mutate: mutateFeedback,
  } = useConfirmedSWR(tenantStudentKeys.feedback(studentId), () =>
    fetchStudentFeedback(studentId),
  );
  // `null` while the history never loaded: no "0 Einträge" next to a load
  // error (#2517).
  const featureDisabled = student?.feedback_enabled === false;
  const feedbackHistory = featureDisabled ? null : feedbackData;
  const loading =
    !featureDisabled && (studentLoading || (!feedbackData && !feedbackError));
  const studentFailure: unknown = student ? null : (studentError ?? null);
  const feedbackFailure: unknown = feedbackData
    ? null
    : (feedbackError ?? null);
  const failure = studentFailure ?? feedbackFailure;
  // A switched-off feature is a state, not an error. It is read from the
  // switch in the child's record, never from the text of the 403.
  const notFound =
    !featureDisabled && failure instanceof ApiError && failure.status === 404;
  const quiet = featureDisabled || notFound;
  const pageLoad = useSwrResourceLoadError(
    [
      { data: student ?? undefined, error: quiet ? undefined : studentError },
      {
        data: feedbackData ?? undefined,
        error: quiet ? undefined : feedbackError,
      },
    ],
    "die Feedbackhistorie",
    () => Promise.all([refreshData(), mutateFeedback()]),
  );
  // Set at once when a load fails, so no „Kind nicht gefunden“ flashes
  // while the catalog text is on its way.
  const failed = pageLoad.failure !== undefined;
  const [timeRange, setTimeRange] =
    useState<(typeof timeRangeOptions)[number]["value"]>("7days");
  const [showDetails, setShowDetails] = useState(false);

  useStudentHistoryBreadcrumb({ studentName: student?.name, referrer });

  // Start at the top instead of inheriting the previous page's scroll position
  useScrollToTop(studentId);

  const today = useBerlinToday();
  const filteredFeedbackHistory = useMemo(() => {
    if (feedbackHistory === null) return [];
    if (timeRange === "all") return feedbackHistory;
    const reference = new Date(berlinDateTimeISO(parseISODate(today), "00:00"));
    const startDay = berlinTodayISO(
      getStartDateForTimeRange(timeRange, reference),
    );
    // The API combines a Berlin DATE and wall-clock TIME without an offset.
    // Compare calendar days, not browser-interpreted instants.
    return feedbackHistory.filter(
      (entry) => entry.timestamp.slice(0, 10) >= startDay,
    );
  }, [feedbackHistory, timeRange, today]);

  // Counts
  const positiveFeedbackCount = filteredFeedbackHistory.filter(
    (e) => e.feedbackType === "positive",
  ).length;
  const neutralFeedbackCount = filteredFeedbackHistory.filter(
    (e) => e.feedbackType === "neutral",
  ).length;
  const negativeFeedbackCount = filteredFeedbackHistory.filter(
    (e) => e.feedbackType === "negative",
  ).length;
  const totalFeedback =
    positiveFeedbackCount + neutralFeedbackCount + negativeFeedbackCount;

  // Chart data: aggregate per day
  const chartData = useMemo(() => {
    const dayMap = new Map<
      string,
      { date: Date; positive: number; neutral: number; negative: number }
    >();

    for (const entry of filteredFeedbackHistory) {
      const d = new Date(entry.timestamp);
      const key = toISODate(d);
      const existing = dayMap.get(key) ?? {
        date: d,
        positive: 0,
        neutral: 0,
        negative: 0,
      };
      existing[entry.feedbackType]++;
      dayMap.set(key, existing);
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => {
        const dayIndex = (v.date.getDay() + 6) % 7;
        return {
          day: DAY_NAMES[dayIndex] ?? "",
          label: `${DAY_NAMES[dayIndex] ?? ""} ${formatDateShort(v.date)}`,
          positive: v.positive,
          neutral: v.neutral,
          negative: v.negative,
        };
      });
  }, [filteredFeedbackHistory]);

  // Group for detail list
  const groupedFeedbackHistory = useMemo(() => {
    const groups: Record<string, FeedbackEntry[]> = {};
    for (const entry of filteredFeedbackHistory) {
      const date = new Date(entry.timestamp).toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      groups[date] ??= [];
      groups[date].push(entry);
    }
    return groups;
  }, [filteredFeedbackHistory]);

  const sortedDates = useMemo(
    () =>
      Object.keys(groupedFeedbackHistory).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime(),
      ),
    [groupedFeedbackHistory],
  );

  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Statuszeile: Klasse, Gruppe und die Zahl der Einträge im gewählten
  // Zeitraum, alles aus den Daten, die die Seite ohnehin geladen hat.
  const feedbackCount =
    feedbackHistory === null
      ? null
      : {
          value: totalFeedback,
          label: totalFeedback === 1 ? "Eintrag" : "Einträge",
        };
  const feedbackLine = feedbackCount
    ? `${feedbackCount.value} ${feedbackCount.label}`
    : null;
  const studentFacts = student
    ? [
        student.school_class,
        student.group_name ? `Gruppe: ${student.group_name}` : null,
      ].filter((part): part is string => Boolean(part))
    : [];
  const studentMeta =
    studentFacts.length + (feedbackCount ? 1 : 0) > 1 ? (
      <TenantPageStats
        items={[
          ...studentFacts.map((label) => ({ label })),
          ...(feedbackCount ? [feedbackCount] : []),
        ]}
      />
    ) : (
      (studentFacts[0] ?? null)
    );
  const errorMessage = loading
    ? null
    : featureDisabled
      ? null
      : failed
        ? pageLoad.error
        : notFound || !student
          ? "Kind nicht gefunden"
          : null;
  const back = studentHistoryBack(
    studentId,
    referrer,
    errorMessage !== null || featureDisabled,
  );

  return (
    <>
      {/* Der Entitätskopf ist die Kopfkarte der Seite. Der Zeitraum ist eine
          Wertauswahl und steht deshalb als Aktion in der Titelzeile. */}
      <TenantPage
        back
        {...back}
        leading={<ConceptIconTile concept={feedbackConcept} size="page" />}
        title={student?.name ?? "Feedbackhistorie"}
        info={FEEDBACK_INFO}
        stats={studentMeta ?? feedbackLine}
        statsLoading={loading}
        loading={loading}
        error={errorMessage}
        empty={
          featureDisabled
            ? {
                title: "Feedbackhistorie ist ausgeschaltet",
                description: FEATURE_DISABLED_DESCRIPTION,
              }
            : !loading && errorMessage === null && totalFeedback === 0
              ? {
                  title:
                    "Kein Feedback für den ausgewählten Zeitraum vorhanden.",
                  description: "Wähle einen anderen Zeitraum.",
                }
              : null
        }
        actions={
          <SegmentedControl
            items={timeRangeOptions}
            value={timeRange}
            onChange={setTimeRange}
            ariaLabel="Zeitraum wählen"
          />
        }
      >
        <SectionCard
          title="Feedback-Übersicht"
          description={FEEDBACK_HISTORY_DESCRIPTION}
          concept={feedbackConcept}
          // Aufklappbare Einzelliste in der randlosen Fußzone.
          footer={
            totalFeedback > 0 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={() => setShowDetails((prev) => !prev)}
                  aria-expanded={showDetails}
                  tooltip={
                    showDetails
                      ? "Blendet die einzelnen Feedback-Einträge wieder aus."
                      : "Zeigt jedes Feedback im gewählten Zeitraum einzeln mit Datum."
                  }
                  className="w-full gap-2"
                >
                  {showDetails ? (
                    <>
                      Einträge ausblenden
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Alle Einträge anzeigen ({totalFeedback})
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </Button>

                {showDetails && (
                  <div className="border-t border-gray-100">
                    {sortedDates.map((dateString) => {
                      const feedbackForDate =
                        groupedFeedbackHistory[dateString] ?? [];
                      const dateObj = new Date(
                        feedbackForDate[0]?.timestamp ?? dateString,
                      );

                      return (
                        <div key={dateString}>
                          <ListGroupHeader
                            className="border-b border-gray-50 sm:px-6"
                            title={dateObj.toLocaleDateString("de-DE", {
                              timeZone: "Europe/Berlin",
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          />
                          <div className="divide-y divide-gray-50 px-4 sm:px-6">
                            {feedbackForDate.map((feedback) => (
                              <div
                                key={feedback.id}
                                className="flex items-center gap-3 py-2.5"
                                data-testid={`feedback-indicator-${feedback.feedbackType}`}
                              >
                                <span className="text-sm text-gray-900">
                                  {feedbackTypeLabels[feedback.feedbackType]}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {formatTime(feedback.timestamp)}
                                </span>
                                {feedback.isMensaFeedback && (
                                  <StatusBadge
                                    label="Mensa"
                                    tone="gray"
                                    compact
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : undefined
          }
        >
          <>
            {/* Proportion bar */}
            <div className="mt-4 flex h-3 overflow-hidden rounded-full">
              {positiveFeedbackCount > 0 && (
                <div
                  style={{
                    backgroundColor: feedbackToneColors.positive,
                    width: `${(positiveFeedbackCount / totalFeedback) * 100}%`,
                  }}
                />
              )}
              {neutralFeedbackCount > 0 && (
                <div
                  style={{
                    backgroundColor: feedbackToneColors.neutral,
                    width: `${(neutralFeedbackCount / totalFeedback) * 100}%`,
                  }}
                />
              )}
              {negativeFeedbackCount > 0 && (
                <div
                  style={{
                    backgroundColor: feedbackToneColors.negative,
                    width: `${(negativeFeedbackCount / totalFeedback) * 100}%`,
                  }}
                />
              )}
            </div>

            {/* Inline stats */}
            <PlanLegend
              size="md"
              className="mt-3"
              entries={[
                {
                  key: "positive",
                  label: "Positiv",
                  value: positiveFeedbackCount,
                  color: feedbackToneColors.positive,
                  variant: "dot",
                },
                {
                  key: "neutral",
                  label: "Neutral",
                  value: neutralFeedbackCount,
                  color: feedbackToneColors.neutral,
                  variant: "dot",
                },
                {
                  key: "negative",
                  label: "Negativ",
                  value: negativeFeedbackCount,
                  color: feedbackToneColors.negative,
                  variant: "dot",
                },
              ]}
            />

            {/* Stacked bar chart */}
            {chartData.length > 1 && (
              <div className="mt-6">
                <FeedbackHistoryChart data={chartData} />
              </div>
            )}
          </>
        </SectionCard>
      </TenantPage>
    </>
  );
}
