"use client";

import type { ReactNode } from "react";

import { isDone, withKeys } from "~/components/home/day-changes-block";
import {
  childChangeText,
  childSummaryTitle,
  dayChangeHref,
  dayChangeLinkHref,
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
} from "~/components/home/day-changes-text";
import { useNoticeAcknowledge } from "~/components/home/day-notice-row";
import { LinkRowMeta } from "~/components/home/home-card-rows";
import { AwayBadge } from "~/components/home/my-group-block";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { blockTimeRange } from "~/lib/block-children";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import type {
  DayChange,
  DayChangeNotice,
  DayChangesOverview,
} from "~/lib/day-changes";
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";
import { useDayPlanHref } from "~/lib/hooks/use-day-plan-href";
import type { HomeGroupSnapshot } from "~/lib/hooks/use-home-group";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { useDeviceContext } from "~/lib/device-context";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Detailflächen der App-Startseite (#8070): rechts neben der Liste (iPad
 * quer), im Blatt (Telefon) oder als zweite Spalte (iPad hoch). Jede Fläche
 * ist EINE Liste mit Trennlinien und nutzt die Daten, die die Startseite
 * schon geladen hat.
 */

// ─── Heute anders als Liste ────────────────────────────────────────────────

/**
 * Die Einträge von „Heute anders“ als Zeilen: was dich betrifft, die übrige
 * Schule, was schon vorbei ist. `include` wählt den Ausschnitt (Kinder oder
 * Team und Schule).
 */
export function DayChangesList({
  overview,
  include,
  label,
  mineTitle = "Betrifft dich",
}: {
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
            <CollectionRow title="Heute läuft hier alles wie geplant." />
          </CollectionGroup>
        </Collection>
      ) : (
        <Collection label={label}>
          {mine.length > 0 ? (
            <CollectionGroup title={mineTitle} count={mine.length}>
              <DayChangeRows entries={mine} />
            </CollectionGroup>
          ) : null}
          {school.length > 0 ? (
            <CollectionGroup title="Schule" count={school.length}>
              <DayChangeRows entries={school} />
            </CollectionGroup>
          ) : null}
          {done.length > 0 ? (
            <CollectionGroup title="Schon vorbei" count={done.length}>
              <DayChangeRows entries={done} />
            </CollectionGroup>
          ) : null}
        </Collection>
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
}: {
  readonly entries: readonly DayChange[];
  /** Vorschau der Startseite: Hinweise nur mit Titel, der Text steht im Blatt. */
  readonly brief?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const dayPlanHref = useDayPlanHref();
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
        const href = dayChangeLinkHref(item.link);
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
    const path = dayChangeHref(entry);
    const href =
      path === null
        ? null
        : entry.link?.target === "day_plan"
          ? dayPlanHref
          : tenantPath(path);
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

// ─── Hinweis der Leitung ───────────────────────────────────────────────────

/** Ein Hinweis mit ganzem Text und „Zur Kenntnis nehmen“ (iPad quer). */
export function NoticeDetail({
  notice,
  onChanged,
}: {
  readonly notice: DayChangeNotice;
  readonly onChanged: () => Promise<unknown>;
}) {
  const { confirm, pending, error } = useNoticeAcknowledge(notice, onChanged);
  return (
    <SectionCard
      title={notice.title}
      titleBadge={
        notice.important ? (
          <StatusBadge label="Wichtig" tone="warning" size="xs" />
        ) : undefined
      }
    >
      {notice.body ? (
        <p className="text-base whitespace-pre-line text-gray-800">
          {notice.body}
        </p>
      ) : null}
      <LoadErrorAlert error={error} className="mt-2" />
      <Button
        type="button"
        variant="primary"
        size="md"
        className="mt-4"
        disabled={pending}
        aria-label={`${notice.title}: zur Kenntnis nehmen`}
        tooltip="Bestätigt sofort, dass du den Hinweis gelesen hast."
        onClick={() => void confirm()}
      >
        {pending ? "Wird gespeichert …" : "Zur Kenntnis nehmen"}
      </Button>
    </SectionCard>
  );
}

// ─── Meine Gruppe ──────────────────────────────────────────────────────────

/** Zwei Spalten, zeilenweise gefüllt, ohne leere Zelle neben einem Kind. */
const WIDE_DETAIL_COLUMNS =
  "[&_ul]:grid [&_ul]:grid-cols-2 [&_ul]:divide-y-0 [&_ul>li]:border-b [&_ul>li]:border-gray-100 [&_ul>li:nth-child(odd)]:border-r [&_ul>li:last-child]:border-b-0 [&_ul>li:nth-last-child(2):nth-child(odd)]:border-b-0";

/**
 * Die eigene Gruppe mit ihren Kindern: wer fehlt noch, wer wird abgeholt,
 * wer ist heute nicht da. Dieselben Daten und Wörter wie „Meine Gruppe
 * heute“ auf dem Desktop; jede Zeile führt zur Gruppe.
 */
export function GroupDetail({
  snapshot,
}: {
  readonly snapshot: HomeGroupSnapshot;
}) {
  const tenantPath = useTenantAwarePath();
  const { isSplit } = useDeviceContext();
  const href = tenantPath("/ogs-groups");
  const { group, present, total, missing, pickups, away } = snapshot;
  if (!group) return null;
  const missingIds = new Set(missing.map((entry) => entry.student.id));
  const pickedIds = new Set(pickups.map((entry) => entry.student.id));
  const awayRest = away.filter(
    (student) => !missingIds.has(student.id) && !pickedIds.has(student.id),
  );
  const name = (student: HomeGroupSnapshot["away"][number]) =>
    `${student.first_name} ${student.last_name}`;
  const label = group.viaSubstitution
    ? `${group.name} (Vertretung)`
    : group.name;

  return (
    <Collection
      label={`Meine Gruppe: ${label}`}
      // iPad quer: Das Detail ist ⅔ breit. Die Kinder stehen zeilenweise in
      // zwei Spalten, damit die Abholzeit nah am Namen steht.
      className={isSplit ? WIDE_DETAIL_COLUMNS : undefined}
    >
      <CollectionGroup title={label} meta={`${present} von ${total} da`}>
        {missing.length + pickups.length + awayRest.length === 0 ? (
          <CollectionRow
            title="Alle da, keine Abholung mehr heute"
            href={href}
          />
        ) : null}
      </CollectionGroup>
      {missing.length > 0 ? (
        <CollectionGroup title="Fehlt noch" count={missing.length}>
          {missing.map(({ student, expected, note }) => (
            <CollectionRow
              key={`missing-${student.id}`}
              title={name(student)}
              subtitle={note ?? student.school_class ?? undefined}
              meta={<StatusBadge tone="red" label={`erwartet ${expected}`} />}
              href={href}
            />
          ))}
        </CollectionGroup>
      ) : null}
      {pickups.length > 0 ? (
        <CollectionGroup title="Abholungen" count={pickups.length}>
          {pickups.map(({ student, time, note, isException }) => (
            <CollectionRow
              key={`pickup-${student.id}`}
              title={name(student)}
              subtitle={note ?? student.school_class ?? undefined}
              meta={
                <span className="flex items-center gap-1.5">
                  {isException ? (
                    <StatusBadge tone="warning" label="Ausnahme" size="xs" />
                  ) : null}
                  <span className="font-semibold text-gray-900">{time}</span>
                </span>
              }
              href={href}
            />
          ))}
        </CollectionGroup>
      ) : null}
      {awayRest.length > 0 ? (
        <CollectionGroup title="Nicht da" count={awayRest.length}>
          {awayRest.map((student) => (
            <CollectionRow
              key={`away-${student.id}`}
              title={name(student)}
              subtitle={student.school_class ?? undefined}
              meta={
                <AwayBadge
                  student={student}
                  onlyIfLessonCancelled={snapshot.onlyIfLessonCancelled.has(
                    student.id,
                  )}
                />
              }
              href={href}
            />
          ))}
        </CollectionGroup>
      ) : null}
    </Collection>
  );
}

// ─── Mein Tag ──────────────────────────────────────────────────────────────

/** Die eigenen Einsätze von heute in Reihenfolge, mit Zeit und Raum. */
export function DayDetail({
  blocks,
}: {
  readonly blocks: readonly PlannedTimetableInstance[];
}) {
  const dayPlanHref = useDayPlanHref();
  if (blocks.length === 0) return null;
  return (
    <Collection label="Mein Tag">
      <CollectionGroup title="Mein Tag" count={blocks.length}>
        {blocks.map((block) => (
          <CollectionRow
            key={block.id}
            title={`${block.startTime} ${block.title}`}
            subtitle={[blockTimeRange(block), block.roomName]
              .filter(Boolean)
              .join(" · ")}
            meta={
              block.status === "active" ? (
                <StatusBadge tone="green" label="Läuft" size="xs" />
              ) : block.status === "completed" ? (
                <StatusBadge tone="gray" label="Beendet" size="xs" />
              ) : undefined
            }
            href={dayPlanHref}
          />
        ))}
      </CollectionGroup>
    </Collection>
  );
}
