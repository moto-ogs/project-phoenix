"use client";

import { STUDENT_SEARCH_LINK_TOOLTIP } from "~/components/home/home-link-tooltips";
import { Fragment, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button, ButtonLink } from "~/components/ui/button";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import { useBerlinClock } from "~/components/home/home-card-rows";
import {
  START_OWN_BLOCK_TOOLTIP,
  useStartOwnBlock,
} from "~/components/home/use-start-own-block";
import { fetchDashboardAnalyticsClient } from "~/lib/dashboard-api";
import type { DashboardAnalytics } from "~/lib/dashboard-helpers";
import { formatStatusDate } from "~/lib/date-helpers";
import type { HomeBlockAccess, HomeBlockContext } from "~/lib/home-blocks";
import { formatMinutesAhead } from "~/lib/home-clock";
import { blockEndLine, blockTimeRange } from "~/lib/block-children";
import {
  deriveHomeNow,
  nowActions,
  startableOwnBlock,
  type HomeNowState,
} from "~/lib/home-now";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useHasOwnStaff } from "~/lib/hooks/use-user-context";
import { createLogger } from "~/lib/logger";
import { ownShiftService } from "~/lib/shift-api";
import type { OwnAssignment } from "~/lib/shift-helpers";
import { useOptionalSupervision } from "~/lib/supervision-context";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys, timeTrackingKeys } from "~/lib/swr/portal-keys";
import { dashboardKeys } from "~/lib/swr/shell-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { timetableOperationsApi } from "~/lib/timetable-operations-api";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { presentConcept } from "~/lib/concepts/present";
import { roomsConcept } from "~/lib/concepts/rooms";

const logger = createLogger({ component: "HomeNowStrip" });

/**
 * Die Daten der Jetzt-Zone (#2180), aus `NowStrip` gezogen, damit die
 * App-Fassung der Startseite (#8070) dieselben Abfragen, Schlüssel und Regeln
 * nutzt. Reines Verschieben: die Desktop-Zone rendert unverändert.
 */
export function useHomeNow(access: HomeBlockAccess, context: HomeBlockContext) {
  const tenantPath = useTenantAwarePath();
  const today = useBerlinToday();
  const now = useBerlinClock();
  // `ownSupervision`, nicht `isSupervising`: Letzteres ist wahr, sobald es
  // einen Schulhof gibt. „Zur Aufsicht" führt nur, wer selbst beaufsichtigt.
  const { ownSupervision } = useOptionalSupervision();

  // Der eigene Tag: für alle, die selbst betreuen. Ein reines Adminkonto hat
  // keine Einsätze; die Abfrage liefe ins Leere.
  // Ohne Personalprofil in dieser Schule (etwa über den Träger) gibt es
  // keine eigenen Einsätze; die Abfrage würde nur abgelehnt (#7306).
  const hasOwnStaff = useHasOwnStaff();
  const wantsOwn =
    context.timetableEnabled &&
    hasOwnStaff &&
    access.has("time_tracking:own") &&
    (access.caresForGroups || !access.isAdminScope);
  // Die Schule: für den Adminzuschnitt, wenn es überhaupt Blöcke gibt.
  const wantsSchool =
    access.isAdminScope &&
    context.timetableEnabled &&
    context.detailed &&
    access.has("schedules:read");
  // Der Tag laut Plan, für „Aufsicht starten": dieselbe Freigabe und
  // derselbe Schlüssel wie „Mein Tag" und „Ablauf des Tages". Die
  // Schulansicht daraus bleibt der Leitung vorbehalten; wer betreut, bekommt
  // aus diesen Daten nur den Knopf.
  const wantsDay = context.timetableEnabled && access.has("schedules:read");
  // Wie viele Kinder da sind: für alle mit dem Recht hinter den Kennzahlen,
  // auch für Betreuungskräfte (#4347). Dieselbe Abfrage wie die Kachel
  // „Kinder anwesend".
  const wantsAnalytics = access.has("groups:read");

  const own = useSWRAuth<OwnAssignment[]>(
    wantsOwn ? timeTrackingKeys.ownAssignmentsToday(today) : null,
    () => ownShiftService.getOwnAssignments(today, today),
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const day = useSWRAuth<PlannedTimetableInstance[]>(
    wantsDay ? homeKeys.dayFlow() : null,
    () =>
      timetableOperationsApi.plannedNow({ scope: "day", includeRoster: false }),
    { refreshInterval: 5 * 60 * 1000 },
  );
  const school = wantsSchool ? day : { data: undefined, error: undefined };
  const analytics = useSWRAuth<DashboardAnalytics>(
    wantsAnalytics ? dashboardKeys.analytics() : null,
    fetchDashboardAnalyticsClient,
    { refreshInterval: 5 * 60 * 1000 },
  );

  if (own.error) {
    logger.error("home_now_own_failed", {
      error: own.error instanceof Error ? own.error.message : String(own.error),
    });
  }
  if (school.error) {
    logger.error("home_now_school_failed", {
      error:
        school.error instanceof Error
          ? school.error.message
          : String(school.error),
    });
  }

  const loading =
    now === "" ||
    (wantsOwn && own.data === undefined && !own.error) ||
    (wantsSchool && school.data === undefined && !school.error);

  // Ein Fehler in einer Quelle nimmt die Zone nicht mit: dann trägt sie nur
  // Uhrzeit und Aktionen, und die Karte darunter meldet den Fehler.
  const state = deriveHomeNow({
    now,
    own: own.error ? undefined : own.data?.filter((a) => a.date === today),
    // Dienste (#3822) werden nie gestartet; als „Nicht gestartet" zu zählen
    // wäre falsch.
    school: school.error
      ? undefined
      : school.data?.filter((block) => block.isDuty !== true),
  });

  // Dieselbe Regel wie der Starten-Knopf in „Mein Tag", aus derselben
  // Abfrage. Ein Fehler dort nimmt nur den Knopf mit, nicht die Zone.
  const startable =
    wantsDay && !day.error
      ? startableOwnBlock(day.data ?? [], new Date())
      : null;
  const { start, busyId } = useStartOwnBlock({
    onFailure: () => day.mutate(),
  });
  const actions = nowActions({
    isSupervising: ownSupervision === true,
    startable,
    canReadUsers: access.has("users:read"),
    tenantPath,
  });
  // Lage der Schule und Datum nennen die Zahl schon im Text. Neben dem
  // eigenen Einsatz steht sie für sich, damit niemand sie dem Block zuordnet.
  const presentCount =
    !loading && state.kind.startsWith("own_")
      ? analytics.data?.studentsPresent
      : undefined;

  return {
    tenantPath,
    today,
    now,
    loading,
    state,
    actions,
    start,
    busyId,
    presentCount,
    analytics,
    ownSupervision: ownSupervision === true,
    /** Der Tag laut Plan (`homeKeys.dayFlow()`), wie „Mein Tag“. */
    dayBlocks: wantsDay && !day.error ? day.data : undefined,
  };
}

/**
 * Die Jetzt-Zone der Startseite (#2180): die eine Zeile, die den Moment
 * trägt. Uhrzeit, was gerade läuft oder als Nächstes kommt, und der eine
 * Weg, der jetzt naheliegt.
 *
 * Sie steht fest über dem Brett und ist kein Baustein: „Was steht jetzt an"
 * ist die Frage, für die es die Startseite gibt, und die Antwort darf nicht
 * davon abhängen, ob jemand eine Karte entfernt hat. Alles darunter bleibt
 * frei anordenbar.
 *
 * Die Abfragen teilen ihre Schlüssel mit den Karten darunter („Mein Tag",
 * „Ablauf des Tages", Kennzahlen): steht die Karte auf der Fläche, kostet
 * die Zone keine zweite Abfrage.
 */
export function NowStrip({
  access,
  context,
}: {
  readonly access: HomeBlockAccess;
  readonly context: HomeBlockContext;
}) {
  const {
    tenantPath,
    today,
    now,
    loading,
    state,
    actions,
    start,
    busyId,
    presentCount,
    analytics,
  } = useHomeNow(access, context);

  return (
    <SectionCard testId="home-now">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {/* Die Uhr ist der Anker der Zone: alles daneben ist relativ zu ihr
              gemeint („bis 11:00", „in 25 Min"). */}
          <time
            dateTime={`${today}T${now}`}
            className="shrink-0 text-3xl font-semibold text-gray-900 tabular-nums"
          >
            {now}
          </time>
          <span aria-hidden="true" className="h-10 w-px shrink-0 bg-gray-200" />
          {loading ? (
            <div className="min-w-0 flex-1 space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <NowText state={state} analytics={analytics.data} today={today} />
          )}
        </div>
        {/* Auf dem Telefon EINE Zeile, die sich die Knöpfe teilen: untereinander
            in voller Breite waren die zwei Wege größer als die Uhr, um die es
            in der Zone geht, und in Knopfgröße blieb rechts ein toter Rest
            stehen. Ab sm stehen sie in Knopfgröße neben dem Text. */}
        {(actions.length > 0 || presentCount !== undefined) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {presentCount !== undefined && (
              <p className="flex items-center gap-1.5 pr-2 text-sm whitespace-nowrap text-gray-600">
                <MotoConceptIcon concept={presentConcept} size={18} />
                <span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {presentCount}
                  </span>{" "}
                  {presentCount === 1 ? "Kind da" : "Kinder da"}
                </span>
              </p>
            )}
            {actions.map((action, index) => {
              const variant = index === 0 ? "primary" : "outline";
              return action.kind === "start" ? (
                <Button
                  key={`start-${action.block.id}`}
                  type="button"
                  variant={variant}
                  size="md"
                  className="whitespace-nowrap max-sm:flex-1"
                  disabled={busyId !== null}
                  onClick={() => void start(action.block)}
                  tooltip={START_OWN_BLOCK_TOOLTIP}
                >
                  {busyId === action.block.id ? "Startet..." : action.label}
                </Button>
              ) : (
                // Ein Weg in einen anderen Bereich trägt den Pfeil (#4346):
                // man sieht, dass der Knopf weiterführt. „Aufsicht starten"
                // wechselt nicht, sondern startet an Ort und Stelle.
                <ButtonLink
                  key={action.href}
                  href={action.href}
                  variant={variant}
                  size="md"
                  className="gap-2 whitespace-nowrap max-sm:flex-1"
                  tooltip={
                    action.href === tenantPath("/active-supervisions")
                      ? "Öffnet deine laufende Aufsicht."
                      : STUDENT_SEARCH_LINK_TOOLTIP
                  }
                >
                  {action.label}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function NowText({
  state,
  analytics,
  today,
  wrap = false,
  lead,
  extra,
  aside,
  withoutDate = false,
}: {
  readonly state: HomeNowState;
  /**
   * App (#8070): die Kopfkarte nennt das Datum schon. Ohne eigenen Einsatz
   * steht dann die Zahl der Kinder als Überschrift statt des Datums.
   */
  readonly withoutDate?: boolean;
  readonly analytics: DashboardAnalytics | undefined;
  readonly today: string;
  /** App: steht vor der Überschrift (die Uhrzeit). */
  readonly lead?: ReactNode;
  /** App: steht am Ende der Angabenzeile (Stempelzustand). */
  readonly extra?: ReactNode;
  /** App: steht rechts in der Titelzeile (Kinder da). */
  readonly aside?: ReactNode;
  /**
   * App (#8070): nie kürzen; die Angaben brechen nur zwischen den Teilen um
   * („Aula · Ende offen ·“ / „danach 12:00 Mittagessen“).
   */
  readonly wrap?: boolean;
}) {
  switch (state.kind) {
    case "own_running": {
      const { block, next } = state;
      return (
        <Lines
          wrap={wrap}
          lead={lead}
          extra={extra}
          aside={aside}
          headline={block.title}
          badges={
            <>
              {/* Die Uhr sagt, dass der Block dran ist; ob er läuft, sagt
                  der Status. Sonst stünde „Läuft" neben „Aufsicht starten".
                  Dieselben Wörter wie im Tagesplan. */}
              {block.status === "active" ? (
                <StatusBadge tone="green" label="Läuft" />
              ) : block.status === "completed" ? (
                <StatusBadge tone="gray" label="Beendet" />
              ) : (
                <StatusBadge tone="warning" label="Nicht gestartet" />
              )}
              {block.isSubstitute && (
                <StatusBadge tone="blue" label="Vertretung" />
              )}
            </>
          }
          detail={[
            block.roomName ? (
              <Fragment key="room">
                {/* App: ohne Symbol wie die Zeilen von „Mein Tag“; so passen
                    Raum, Ende und „danach …“ am SE in eine Zeile. */}
                {wrap ? null : (
                  <MotoConceptIcon
                    concept={roomsConcept}
                    size={14}
                    className="mr-1 inline-block align-[-2px]"
                  />
                )}
                {block.roomName}
              </Fragment>
            ) : null,
            blockEndLine(block),
            next
              ? `danach ${next.startTime} ${next.title}`
              : // App: Ohne Folgeblock entfällt der Satz, die Karte bleibt
                // zweizeilig. Der Desktop sagt ihn weiter.
                wrap
                ? null
                : "danach ist für heute nichts mehr geplant",
          ]}
        />
      );
    }
    case "own_next": {
      const { block, minutesAhead } = state;
      return (
        <Lines
          wrap={wrap}
          lead={lead}
          extra={extra}
          aside={aside}
          headline={`Als Nächstes: ${block.title}`}
          badges={
            <>
              <StatusBadge
                tone="blue"
                label={formatMinutesAhead(minutesAhead)}
              />
              {block.isSubstitute && (
                <StatusBadge tone="blue" label="Vertretung" />
              )}
            </>
          }
          detail={[
            blockTimeRange(block),
            block.roomName ? (
              <Fragment key="room">
                <MotoConceptIcon
                  concept={roomsConcept}
                  size={14}
                  className="mr-1 inline-block align-[-2px]"
                />
                {block.roomName}
              </Fragment>
            ) : null,
          ]}
        />
      );
    }
    case "own_done":
      return (
        <Lines
          wrap={wrap}
          lead={lead}
          extra={extra}
          aside={aside}
          headline="Für heute ist alles erledigt"
          detail={[
            state.count === 1
              ? "1 Einsatz heute"
              : `${state.count} Einsätze heute`,
          ]}
        />
      );
    case "school": {
      const { running, notStarted, next, minutesAhead, total } = state;
      // „Alles vorbei" erst, wenn auch nichts mehr überfällig ist: ein Block,
      // den niemand gestartet hat, ist nicht vorbei, nur weil nach ihm
      // nichts mehr kommt.
      const headline =
        running > 0
          ? running === 1
            ? "1 Block läuft"
            : `${running} Blöcke laufen`
          : next || notStarted > 0
            ? "Gerade läuft kein Block"
            : total > 0
              ? "Für heute ist alles vorbei"
              : "Heute ist keine Betreuung geplant";
      return (
        <Lines
          wrap={wrap}
          lead={lead}
          extra={extra}
          aside={aside}
          headline={headline}
          badges={
            notStarted > 0 ? (
              <StatusBadge
                tone="warning"
                label={`${notStarted} nicht gestartet`}
              />
            ) : undefined
          }
          detail={[
            analytics ? childrenPresent(analytics.studentsPresent) : "",
            analytics ? staffOnDuty(analytics.supervisorsToday) : "",
            next && minutesAhead !== null
              ? `als Nächstes ${next.startTime} ${next.title} (${formatMinutesAhead(minutesAhead)})`
              : "",
          ]}
        />
      );
    }
    case "plain":
      return (
        <Lines
          wrap={wrap}
          lead={lead}
          extra={extra}
          aside={aside}
          headline={
            withoutDate && analytics
              ? childrenPresent(analytics.studentsPresent)
              : formatStatusDate(today)
          }
          detail={
            analytics
              ? withoutDate
                ? [staffOnDuty(analytics.supervisorsToday)]
                : [
                    childrenPresent(analytics.studentsPresent),
                    staffOnDuty(analytics.supervisorsToday),
                  ]
              : []
          }
        />
      );
  }
}

/**
 * App (#8070): der eigene Block, der laut Tagesplan gerade läuft, auch wenn
 * er in den Einsätzen des Dienstplans fehlt (ein spontan gestarteter Block
 * „seit 00:03“). Sonst sagte die Karte „Für heute ist alles erledigt“,
 * während „Mein Tag“ darunter „Läuft“ zeigt.
 */
export function NowRunningText({
  block,
  next,
  lead,
  extra,
  aside,
}: {
  readonly block: PlannedTimetableInstance;
  /** Der nächste eigene Einsatz, falls einer kommt. */
  readonly next: { readonly startTime: string; readonly title: string } | null;
  readonly lead?: ReactNode;
  readonly extra?: ReactNode;
  readonly aside?: ReactNode;
}) {
  return (
    <Lines
      wrap
      lead={lead}
      extra={extra}
      aside={aside}
      headline={block.title}
      badges={
        <>
          <StatusBadge tone="green" label="Läuft" />
          {block.isSubstitute ? (
            <StatusBadge tone="blue" label="Vertretung" />
          ) : null}
        </>
      }
      detail={[
        block.roomName,
        blockEndLine(block),
        next ? `danach ${next.startTime} ${next.title}` : null,
      ]}
    />
  );
}

function childrenPresent(count: number): string {
  return count === 1 ? "1 Kind da" : `${count} Kinder da`;
}

function staffOnDuty(count: number): string {
  // „vom Team" statt „Kräfte": dasselbe Wort wie der Baustein „Personal
  // heute" und die Seitenleiste, und es liest sich wie gesprochen.
  return `${count} vom Team in Aufsicht`;
}

function Lines({
  headline,
  badges,
  detail,
  wrap = false,
  lead,
  extra,
  aside,
}: {
  readonly wrap?: boolean;
  readonly lead?: ReactNode;
  readonly extra?: ReactNode;
  readonly aside?: ReactNode;
  readonly headline: string;
  readonly badges?: ReactNode;
  // Raumangaben tragen ihr Symbol wie in den Blockzeilen (#4350).
  readonly detail: readonly ReactNode[];
}) {
  const parts = detail.filter(Boolean);
  if (wrap) {
    // App (#8070): zwei feste Zeilen. Oben Uhrzeit, Titel und Zustand, rechts
    // die Kinder da; darunter Raum, Ende und was danach kommt. Bricht die
    // Angabenzeile um, beginnt die neue Zeile ohne Trenner und keine endet
    // auf „·“: Der Punkt steht vor jedem Teil und fällt am Zeilenanfang in
    // den abgeschnittenen Rand (`-ml-3` in `overflow-hidden`).
    const items = extra ? [...parts, extra] : parts;
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-base leading-6 font-semibold text-gray-900">
            {lead}
            <span className="min-w-0">{headline}</span>
            {badges ? (
              <span className="inline-flex items-center gap-1 self-center font-normal">
                {badges}
              </span>
            ) : null}
          </p>
          {aside ? (
            <span className="shrink-0 text-sm leading-6 text-gray-500">
              {aside}
            </span>
          ) : null}
        </div>
        {items.length > 0 ? (
          <div className="mt-0.5 overflow-hidden text-sm leading-6 text-gray-500">
            <p className="-ml-3 flex flex-wrap items-center">
              {items.map((part, index) => (
                <span
                  key={index}
                  className="relative min-w-0 pl-3 before:absolute before:left-1 before:content-['·']"
                >
                  {part}
                </span>
              ))}
            </p>
          </div>
        ) : null}
      </div>
    );
  }
  const text =
    parts.length > 0
      ? parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))
      : null;
  return (
    <div className="min-w-0 flex-1">
      {/* Auf dem Handy darf der Satz umbrechen; erst nebeneinander mit den
          Knöpfen wird er auf eine Zeile gekürzt. */}
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-gray-900 sm:truncate">
          {headline}
        </span>
        {badges}
      </p>
      {text && <p className="text-sm text-gray-500 sm:truncate">{text}</p>}
    </div>
  );
}
