"use client";

import { useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";

import { isDone, withKeys } from "~/components/home/day-changes-block";
import {
  childChangeText,
  childSummaryTitle,
  dayChangeLinkHref,
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
} from "~/components/home/day-changes-text";
import { LinkRowMeta } from "~/components/home/home-card-rows";
import { Alert } from "~/components/ui/alert";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { StatusBadge } from "~/components/ui/status-badge";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import type { DayChange, DayChangesOverview } from "~/lib/day-changes";
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";
import { useDayChangeHref } from "~/components/home/day-change-link";
import {
  DaySwitch,
  isOverviewOfDay,
  nextDayISO,
} from "~/components/home/day-switch";
import type { DayChangesDay } from "~/components/home/day-changes-text";
import { SkeletonRows } from "~/components/ui/skeleton";
import { trackEvent } from "~/lib/analytics";
import { fetchDayChanges } from "~/lib/day-changes";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Detailflächen der App-Startseite (#8070), im Blatt. Jede Fläche ist EINE
 * Liste mit Trennlinien und nutzt die Daten, die die Startseite
 * schon geladen hat.
 */

// ─── Heute anders als Liste ────────────────────────────────────────────────

/**
 * Die Einträge von „Heute anders“ als Zeilen: was dich betrifft, die übrige
 * Schule, was schon vorbei ist. `include` wählt den Ausschnitt (Kinder oder
 * Team und Schule).
 */
function DayChangesList({
  overview,
  include,
  label,
  mineTitle = "Betrifft dich",
  day = "today",
}: {
  /** Der gezeigte Tag (#7657): morgen führen Kinder-Zeilen nirgendwohin. */
  readonly day?: DayChangesDay;
  readonly overview: DayChangesOverview;
  readonly include: (entry: DayChange) => boolean;
  /** Name der Liste für Vorleseprogramme. */
  readonly label: string;
  /** Kopf der eigenen Einträge (Standard „Betrifft dich“). */
  readonly mineTitle?: string;
}) {
  const now = useCurrentTimestamp();
  const entries = overview.entries.filter(
    (entry) => dayChangeText(entry) !== null && include(entry),
  );
  const open = entries.filter((entry) => !isDone(entry, now));
  const done = entries.filter((entry) => isDone(entry, now));
  const mine = open.filter((entry) => entry.section === "you");
  const school = open.filter((entry) => entry.section !== "you");
  const failures = overview.failedSources.map((source) => (
    <Alert
      key={source}
      type="warning"
      size="compact"
      message={sourceFailureText(source)}
    />
  ));

  return (
    <div className="space-y-3">
      {failures}
      {entries.length === 0 ? (
        <Collection label={label}>
          <CollectionGroup title={label}>
            <CollectionRow
              title={
                day === "tomorrow"
                  ? "Morgen läuft hier alles wie geplant."
                  : "Heute läuft hier alles wie geplant."
              }
            />
          </CollectionGroup>
        </Collection>
      ) : (
        <Collection label={label}>
          {mine.length > 0 ? (
            <CollectionGroup title={mineTitle} count={mine.length}>
              <DayChangeRows entries={mine} day={day} date={overview.date} />
            </CollectionGroup>
          ) : null}
          {school.length > 0 ? (
            <CollectionGroup title="Schule" count={school.length}>
              <DayChangeRows entries={school} day={day} date={overview.date} />
            </CollectionGroup>
          ) : null}
          {done.length > 0 ? (
            <CollectionGroup title="Schon vorbei" count={done.length}>
              <DayChangeRows entries={done} day={day} date={overview.date} />
            </CollectionGroup>
          ) : null}
        </Collection>
      )}
    </div>
  );
}

/**
 * Das Blatt „Heute anders“ mit dem Umschalter Heute / Morgen wie die Karte
 * am Desktop (#7657): morgen ist der nächste Kalendertag, auch am Wochenende.
 * Heute zeigt die schon geladene Übersicht der Startseite, morgen lädt erst
 * beim Umschalten.
 */
export function DayChangesDaySheet({
  overview,
  include,
}: {
  readonly overview: DayChangesOverview;
  readonly include: (entry: DayChange) => boolean;
}) {
  const { data: session } = useSession();
  const accountId = session?.user?.id ?? "";
  const [day, setDay] = useState<DayChangesDay>("today");
  const tomorrow = nextDayISO(overview.date);
  const read = useSWRAuth<DayChangesOverview>(
    day === "tomorrow" ? homeKeys.dayChanges(accountId, tomorrow) : null,
    () => fetchDayChanges(tomorrow),
    { revalidateOnFocus: true },
  );
  const loadError = useSwrLoadError(
    day === "tomorrow" ? read.error : undefined,
    "die Übersicht „Heute anders“",
    () => read.mutate(),
  );
  const tomorrowOverview = isOverviewOfDay(read.data, tomorrow)
    ? read.data
    : undefined;
  return (
    <div className="space-y-3">
      <DaySwitch
        value={day}
        onChange={(next) => {
          if (next === "tomorrow") trackEvent("day_changes_tomorrow_shown");
          setDay(next);
        }}
      />
      {day === "today" ? (
        <DayChangesList
          overview={overview}
          include={include}
          label="Heute anders"
        />
      ) : loadError ? (
        <LoadErrorAlert error={loadError} />
      ) : tomorrowOverview ? (
        <DayChangesList
          overview={tomorrowOverview}
          include={include}
          label="Morgen anders"
          day="tomorrow"
        />
      ) : (
        <SkeletonRows rows={3} />
      )}
    </div>
  );
}

/**
 * „Heute anders“ auf der Startseite der App (#8070): dieselbe Karte wie am
 * Desktop, damit man sie wiedererkennt, aber als Liste: die ersten offenen
 * Änderungen als ganze Sätze, zuerst was dich betrifft. Der Rest steht im
 * Blatt hinter „Alle anzeigen“.
 */
export function DayChangesPreview({
  overview,
  include,
  limit = 3,
  onShowAll,
  lead,
  leadCount = 0,
}: {
  /** Zeilen vor den Änderungen: Hinweise zur Kenntnisnahme, wie am Desktop. */
  readonly lead?: ReactNode;
  /** Wie viele Einträge `lead` sind; sie zählen im Kopf mit. */
  readonly leadCount?: number;
  readonly overview: DayChangesOverview;
  readonly include: (entry: DayChange) => boolean;
  /** So viele Änderungen stehen auf der Startseite. */
  readonly limit?: number;
  readonly onShowAll: () => void;
}) {
  const now = useCurrentTimestamp();
  const entries = overview.entries.filter(
    (entry) => dayChangeText(entry) !== null && include(entry),
  );
  const open = entries.filter((entry) => !isDone(entry, now));
  const ordered = [
    ...open.filter((entry) => entry.section === "you"),
    ...open.filter((entry) => entry.section !== "you"),
  ];
  const shown = ordered.slice(0, limit);
  // Der Zähler im Kopf nennt, was offen ist: die Zeilen im Bild plus
  // „N weitere“ ergeben genau ihn. Was heute schon vorbei ist, zählt wie
  // am Desktop („3 erledigt“) für sich und steht ebenfalls im Blatt.
  const rest = open.length - shown.length;
  const done = entries.length - open.length;
  const openCount = leadCount + open.length;
  const restLabel = [
    rest > 0 ? `${rest} weitere` : null,
    done > 0 ? `${done} erledigt` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {overview.failedSources.map((source) => (
        <Alert
          key={source}
          type="warning"
          size="compact"
          message={sourceFailureText(source)}
        />
      ))}
      <Collection label="Heute anders">
        <CollectionGroup
          title={
            <span className="inline-flex items-center gap-2 align-middle">
              <MotoConceptIcon concept={dayChangesConcept} size={18} />
              Heute anders
            </span>
          }
          count={openCount > 0 ? openCount : undefined}
        >
          {lead}
          {shown.length > 0 ? (
            <DayChangeRows entries={shown} brief />
          ) : lead ? null : (
            <CollectionRow title="Heute läuft alles wie geplant." />
          )}
          {restLabel ? (
            <CollectionRow
              title="Alle anzeigen"
              meta={<LinkRowMeta>{restLabel}</LinkRowMeta>}
              onClick={onShowAll}
            />
          ) : null}
        </CollectionGroup>
      </Collection>
    </>
  );
}

function DayChangeRows({
  entries,
  brief = false,
  day = "today",
  date,
}: {
  readonly entries: readonly DayChange[];
  /** Morgen (#7657): wie am Desktop ohne Link in die Kindakte. */
  readonly day?: DayChangesDay;
  /** Der gezeigte Kalendertag, für Links in den Tagesplan. */
  readonly date?: string;
  /** Vorschau der Startseite: Hinweise nur mit Titel, der Text steht im Blatt. */
  readonly brief?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const changeHref = useDayChangeHref();
  // Vorschau: jede Zeile höchstens zwei Zeilen hoch. Der Satz hat Vorrang;
  // die Angabe (Zeitraum, Gruppe) folgt grau dahinter und wird zuerst
  // gekürzt. Der ganze Text steht unter „Alle anzeigen“ und am Ziel.
  // Vorschau wie die Hinweis-Zeile darüber: Satz als Titel, darunter für
  // wen er gilt („Betrifft dich“ / „Schule“) und die Angabe. So hat jede
  // Zeile zwei Zeilen, statt einmal Satz allein und einmal Satz mit
  // Unterzeile (#8070 R21).
  const text = (
    title: string,
    subtitle: string | null | undefined,
    entry: DayChange,
  ) =>
    brief
      ? {
          title,
          subtitle: [
            entry.section === "you" ? "Betrifft dich" : "Schule",
            subtitle,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : { title, subtitle: subtitle ?? undefined };
  const rows: ReactNode[] = [];
  for (const [key, entry] of withKeys(entries)) {
    if (entry.notice) {
      rows.push(
        <CollectionRow
          key={key}
          wrap
          {...text(
            entry.notice.title,
            brief ? null : entry.notice.body || null,
            entry,
          )}
          meta={
            entry.notice.important ? (
              <StatusBadge label="Wichtig" tone="warning" size="xs" />
            ) : undefined
          }
          href={tenantPath("/tagesinformationen")}
        />,
      );
      continue;
    }
    if (entry.childSummary) {
      // Eine Gruppe oder Klasse außerhalb der eigenen: jedes Kind als Zeile,
      // die Gruppe steht darunter.
      const where = childSummaryTitle(entry);
      for (const item of entry.childSummary.items) {
        const childText = childChangeText(item.kind, item.child);
        if (!childText) continue;
        const href =
          day === "tomorrow" && item.link?.target === "student"
            ? null
            : dayChangeLinkHref(item.link);
        rows.push(
          <CollectionRow
            key={`${key}:${item.kind}:${item.child.studentId}`}
            wrap
            {...text(childText, where, entry)}
            {...(href ? { href: tenantPath(href) } : {})}
          />,
        );
      }
      continue;
    }
    const href = changeHref(entry.link, day, date);
    rows.push(
      <CollectionRow
        key={key}
        wrap
        {...text(dayChangeText(entry) ?? "", dayChangeSpan(entry), entry)}
        {...(href ? { href } : {})}
      />,
    );
  }
  return <>{rows}</>;
}
