"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { StatusBadge } from "~/components/ui/status-badge";
import { usePickupChangeNotices } from "~/lib/hooks/use-pickup-change-notices";
import { createLogger } from "~/lib/logger";
import { pickupDayLabel } from "~/lib/pickup-day-label";
import type { PickupChangeNotice } from "~/lib/pickup-change-notices-api";
import { fetchStudentPickupData } from "~/lib/pickup-schedule-api";
import type { PickupException } from "~/lib/pickup-schedule-helpers";
import { formatPickupTime } from "~/lib/pickup-schedule-helpers";
import { useTenantMutate } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";

const logger = createLogger({ component: "PickupChangeAlert" });

const NO_FRESH_CHANGES: readonly PickupChangeNotice[] = [];

/** One revision of a change: a later edit of the same request is new again. */
function revisionKey(notice: PickupChangeNotice): string {
  return `${notice.requestId}@${notice.informedAt}`;
}

export interface PickupChange {
  readonly date: string;
  /** The time that applies; empty when the regular time applies again. */
  readonly time: string;
  /** The reader has not seen this change yet (#6855). */
  readonly isNew?: boolean;
}

interface PickupPersonChange {
  readonly requestId: string;
  readonly informedAt: string;
  readonly date: string;
  readonly person: string;
  readonly withdrawn: boolean;
}

/**
 * Die Tage ab heute mit einer geänderten Abholzeit (#6855). Eine von den
 * Eltern angefragte Zeit wird mit der Freigabe zur Ausnahme der OGS; die
 * Herkunft trägt die Ausnahme danach nicht mehr. Der Hinweis zeigt deshalb
 * jede Tagesausnahme mit Uhrzeit. Eine Ausnahme gibt es je Kind und Tag nur
 * einmal: gezeigt wird immer der aktuelle Stand. Zurückgenommene Ausnahmen
 * sind gelöscht und fehlen, vergangene Tage fallen heraus.
 *
 * `fresh` sind die ungelesenen Zeitänderungen: ein Tag mit Ausnahme trägt
 * „Neu“, eine zurückgenommene Zeitänderung ohne Ausnahme steht als „wieder
 * normale Abholzeit“ mit „Neu“ dabei.
 */
export function upcomingPickupChanges(
  exceptions: readonly PickupException[],
  today: string,
  fresh: readonly PickupChangeNotice[] = [],
): PickupChange[] {
  const freshDays = new Set(
    fresh
      .filter((notice) => !notice.withdrawn && notice.pickupTime !== "")
      .map((notice) => notice.date),
  );
  const changes: PickupChange[] = exceptions
    .filter(
      (exception) =>
        Boolean(exception.pickupTime) && exception.exceptionDate >= today,
    )
    .map((exception) => ({
      date: exception.exceptionDate,
      time: formatPickupTime(exception.pickupTime ?? ""),
      ...(freshDays.has(exception.exceptionDate) ? { isNew: true } : {}),
    }));
  const changedDays = new Set(changes.map((change) => change.date));
  for (const notice of fresh) {
    if (
      notice.withdrawn &&
      (notice.pickupTime !== "" || notice.pickupPerson === "") &&
      notice.date >= today &&
      !changedDays.has(notice.date)
    ) {
      changedDays.add(notice.date);
      changes.push({ date: notice.date, time: "", isNew: true });
    }
  }
  return changes.sort((a, b) => a.date.localeCompare(b.date));
}

function upcomingPickupPersonChanges(
  fresh: readonly PickupChangeNotice[],
  today: string,
): PickupPersonChange[] {
  return fresh
    .filter((notice) => notice.pickupPerson !== "" && notice.date >= today)
    .map((notice) => ({
      requestId: notice.requestId,
      informedAt: notice.informedAt,
      date: notice.date,
      person: notice.pickupPerson,
      withdrawn: notice.withdrawn,
    }));
}

function changeLine(change: PickupChange, today: string): string {
  const day = pickupDayLabel(change.date, today);
  return change.time === ""
    ? `${day}: wieder normale Abholzeit`
    : `${day}: ${change.time} Uhr`;
}

function ChangeLine({
  change,
  today,
}: Readonly<{ change: PickupChange; today: string }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {changeLine(change, today)}
      {change.isNew ? (
        <StatusBadge
          compact
          tone="red"
          label="Neu"
          accessibleLabel="Neu: Diese Änderung hast du noch nicht gesehen."
        />
      ) : null}
    </span>
  );
}

function PickupPersonChangeLine({
  change,
  today,
}: Readonly<{ change: PickupPersonChange; today: string }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {change.withdrawn
        ? `${pickupDayLabel(change.date, today)}: Abholperson zurückgenommen`
        : `${pickupDayLabel(change.date, today)}: ${change.person} holt ab`}
      <StatusBadge
        compact
        tone="red"
        label="Neu"
        accessibleLabel="Neu: Diese Änderung hast du noch nicht gesehen."
      />
    </span>
  );
}

/**
 * Banner in der Kinderakte (#7707): Die Abholung hat sich an einzelnen Tagen
 * geändert, und die Person hat es noch nicht gesehen. Es listet nur diese
 * Änderungen und lässt sich per X schließen. Der dauerhafte Stand steht in
 * den Betreuungszeiten; wer das Banner schließt, verliert also nichts.
 */
export function PickupChangeAlert({
  exceptions,
  today,
  fresh = NO_FRESH_CHANGES,
  onDismiss,
}: Readonly<{
  exceptions: readonly PickupException[] | undefined;
  today: string;
  fresh?: readonly PickupChangeNotice[];
  onDismiss?: () => void;
}>) {
  const changes = upcomingPickupChanges(exceptions ?? [], today, fresh).filter(
    (change) => change.isNew,
  );
  const personChanges = upcomingPickupPersonChanges(fresh, today);
  const count = changes.length + personChanges.length;
  if (count === 0) return null;
  const message =
    count === 1 && changes.length === 1 ? (
      <ChangeLine change={changes[0]!} today={today} />
    ) : count === 1 ? (
      <PickupPersonChangeLine change={personChanges[0]!} today={today} />
    ) : (
      <ul className="list-none space-y-0.5">
        {changes.map((change) => (
          <li key={`time-${change.date}`}>
            <ChangeLine change={change} today={today} />
          </li>
        ))}
        {personChanges.map((change) => (
          <li key={`person-${change.requestId}@${change.informedAt}`}>
            <PickupPersonChangeLine change={change} today={today} />
          </li>
        ))}
      </ul>
    );
  return (
    <Alert
      type="info"
      title="Abholung an einzelnen Tagen geändert"
      message={message}
      announce="off"
      onDismiss={onDismiss}
      dismissLabel="Hinweis zur geänderten Abholung schließen"
      data-testid="pickup-change-alert"
    />
  );
}

/**
 * Der Hinweis in der Kinderakte mit dem Lesestand der Person (#6855): Öffnen
 * des Kindes heißt gesehen. Vorher lädt die Akte die Abholzeiten neu, denn
 * die Abfrage der Hinweise frischt sie nicht auf. Bestätigt werden nur die
 * Hinweise, die dabei geladen waren; „Neu“ bleibt stehen, solange die Akte
 * offen ist, der Zähler im Header geht sofort zurück.
 */
export function StudentPickupChanges({
  studentId,
  exceptions,
  today,
}: Readonly<{
  studentId: string;
  exceptions: readonly PickupException[] | undefined;
  today: string;
}>) {
  const { notices, markRead } = usePickupChangeNotices();
  const tenantMutate = useTenantMutate();
  const [seen, setSeen] = useState<readonly PickupChangeNotice[]>([]);
  const unreadHere = useMemo(
    () => notices.filter((notice) => notice.studentId === studentId),
    [notices, studentId],
  );
  const loaded = exceptions !== undefined;
  // Each loaded revision is confirmed once per visit; a failed confirmation
  // keeps the header counter and is retried on the next visit.
  const confirmed = useRef(new Set<string>());
  useEffect(() => {
    const pending = unreadHere.filter(
      (notice) => !confirmed.current.has(revisionKey(notice)),
    );
    if (!loaded || pending.length === 0) return;
    for (const notice of pending) {
      confirmed.current.add(revisionKey(notice));
    }
    // A started confirmation finishes even if the list or the page changes
    // meanwhile: it names its child and its revisions itself.
    // A revalidation can resolve cached data after a failed fetch. Mutate
    // with an explicit fetch so only a successful refresh is acknowledged.
    void tenantMutate(
      studentKeys.pickupData(studentId),
      () => fetchStudentPickupData(studentId),
      { revalidate: false },
    )
      .then(async (refreshed) => {
        // A scope or data-generation change discards the refresh.
        if (refreshed === undefined) return;
        setSeen((previous) => [
          ...previous.filter(
            (old) =>
              !pending.some((notice) => notice.requestId === old.requestId),
          ),
          ...pending,
        ]);
        await markRead(studentId, pending);
      })
      .catch((caught: unknown) => {
        // A failed refresh or confirmation leaves the header counter intact.
        logger.warn("pickup_change_notices_read_failed", {
          error: caught instanceof Error ? caught.message : String(caught),
        });
      });
  }, [loaded, unreadHere, tenantMutate, markRead, studentId]);
  // Unread revisions replace this visit's seen state, even if their pickup
  // refresh fails. A previous withdrawal must not hide a newer approval.
  // Seen state stays with its child when the record switches children.
  const fresh = useMemo(
    () => [
      ...seen.filter(
        (old) =>
          old.studentId === studentId &&
          !unreadHere.some((notice) => notice.requestId === old.requestId),
      ),
      ...unreadHere,
    ],
    [seen, unreadHere, studentId],
  );
  // The X hides the revisions shown at that moment; a newer one brings the
  // banner back. Reading them was already confirmed on opening the record.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const undismissed = useMemo(
    () => fresh.filter((notice) => !dismissed.has(revisionKey(notice))),
    [fresh, dismissed],
  );
  return (
    <PickupChangeAlert
      exceptions={exceptions}
      today={today}
      fresh={undismissed}
      onDismiss={() =>
        setDismissed(
          (previous) => new Set([...previous, ...undismissed.map(revisionKey)]),
        )
      }
    />
  );
}
