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
  berlinTodayISO,
  berlinDateTimeISO,
  parseISODate,
} from "~/lib/date-helpers";
import { useStudentHistoryBreadcrumb } from "~/lib/breadcrumb-context";
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
import { ColorBar } from "~/components/ui/color-bar";
import {
  feedbackChartData,
  feedbackClock,
  feedbackSince,
  groupFeedbackByDay,
} from "./feedback-history-view";

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

function entryCountLabel(count: number): string {
  return count === 1 ? "1 Eintrag" : `${count} Einträge`;
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

  const today = useBerlinToday();
  const filteredFeedbackHistory = useMemo(() => {
    if (feedbackHistory === null) return [];
    if (timeRange === "all") return feedbackHistory;
    const reference = new Date(berlinDateTimeISO(parseISODate(today), "00:00"));
    const startDay = berlinTodayISO(
      getStartDateForTimeRange(timeRange, reference),
    );
    // Schultage vergleichen, keine vom Browser gedeuteten Zeitpunkte.
    return feedbackSince(feedbackHistory, startDay);
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

  // Diagramm und Einzelliste lesen denselben Schultag und dieselbe
  // Wanduhrzeit, in jeder Gerätezeitzone (#8270).
  const chartData = useMemo(
    () => feedbackChartData(filteredFeedbackHistory),
    [filteredFeedbackHistory],
  );
  const dayGroups = useMemo(
    () => groupFeedbackByDay(filteredFeedbackHistory),
    [filteredFeedbackHistory],
  );

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
                    {dayGroups.map((group) => (
                      <section key={group.day}>
                        <ListGroupHeader
                          className="border-b border-gray-50 sm:px-6"
                          title={group.label}
                          meta={entryCountLabel(group.entries.length)}
                        />
                        <ul className="divide-y divide-gray-50 px-4 sm:px-6">
                          {group.entries.map((feedback) => (
                            <li
                              key={feedback.id}
                              className="flex items-center gap-3 py-2.5"
                              data-testid={`feedback-indicator-${feedback.feedbackType}`}
                            >
                              <time
                                dateTime={`${feedback.day}T${feedback.time}`}
                                className="w-11 shrink-0 text-sm font-semibold text-gray-900 tabular-nums"
                              >
                                {feedbackClock(feedback.time)}
                              </time>
                              <ColorBar
                                color={
                                  feedbackToneColors[feedback.feedbackType]
                                }
                                size="md"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                                {feedbackTypeLabels[feedback.feedbackType]}
                              </span>
                              {feedback.isMensaFeedback && (
                                <StatusBadge
                                  label="Mensa"
                                  tone="gray"
                                  compact
                                />
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
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
