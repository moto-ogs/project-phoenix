"use client";

/**
 * What became of the mails of an absence request (#7058). The Leitung sees
 * under a decided or questioned request whether its mail reached the person;
 * the person sees under a waiting request whether the Leitung got the notice.
 * A mail that arrived stays a quiet pill; only one that did not adds the next
 * step. moto cannot send these mails again, so the step is to tell directly.
 */

import { type ReactNode, useEffect } from "react";

import {
  MailOutcomeBadge,
  MailOutcomeBadges,
} from "~/components/messaging/message-mail-status";
import {
  undeliveredMailNote,
  undeliveredMailsNote,
  type MailOutcome,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { staffAbsenceService } from "~/lib/staff-api";
import { useSWRAuth } from "~/lib/swr";
import { absenceMailKeys } from "~/lib/swr/staff-keys";
import { timeTrackingService } from "~/lib/time-tracking-api";

const logger = createLogger({ component: "AbsenceMailStatus" });

// A mail's outcome arrives after the decision; the status follows while the
// list stays open.
const MAIL_REFRESH_MS = 30_000;

function useLoggedLoadError(error: unknown, event: string) {
  useEffect(() => {
    if (error === undefined) return;
    logger.warn(event, {
      error: error instanceof Error ? error.message : String(error),
    });
  }, [error, event]);
}

/**
 * The newest decision or question mail of each listed request, for the
 * Leitung. `absenceIds` are the rows the list shows.
 */
export function useAbsenceDecisionMails(absenceIds: readonly string[]) {
  const key =
    absenceIds.length > 0 ? absenceMailKeys.decisions(absenceIds) : null;
  const { data, error, mutate } = useSWRAuth(
    key,
    () => staffAbsenceService.decisionMails(absenceIds),
    { refreshInterval: MAIL_REFRESH_MS, shouldRetryOnError: false },
  );
  useLoggedLoadError(error, "absence_decision_mails_load_failed");
  const loadError = useSwrLoadError(error, "der Stand der E-Mails", () =>
    mutate(),
  );
  return { mails: data ?? {}, loadError };
}

/**
 * The notices of the caller's own waiting requests to the Leitung. The server
 * picks the waiting requests itself; `waitingIds` only reloads the status
 * when a request is added or decided.
 */
export function useOwnAbsenceRequestMails(waitingIds: readonly string[]) {
  const key =
    waitingIds.length > 0 ? absenceMailKeys.ownRequests(waitingIds) : null;
  const { data, error, mutate } = useSWRAuth(
    key,
    () => timeTrackingService.getAbsenceRequestMails(),
    { refreshInterval: MAIL_REFRESH_MS, shouldRetryOnError: false },
  );
  useLoggedLoadError(error, "own_absence_request_mails_load_failed");
  const loadError = useSwrLoadError(error, "der Stand der E-Mails", () =>
    mutate(),
  );
  return { mails: data ?? {}, loadError };
}

function MailLine({
  label,
  badge,
  note,
}: Readonly<{ label: string; badge: ReactNode; note: string | null }>) {
  return (
    <div className="mt-1 space-y-0.5" data-testid="absence-mail-status">
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span>{label}</span>
        {badge}
      </p>
      {note && <p className="text-xs text-gray-700">{note}</p>}
    </div>
  );
}

/** The newest mail to the person about a decision or a question. */
export function AbsenceDecisionMail({
  outcome,
  question,
}: Readonly<{ outcome?: MailOutcome | null; question: boolean }>) {
  if (!outcome) return null;
  return (
    <MailLine
      label={question ? "Mail zur Rückfrage" : "Mail zur Entscheidung"}
      badge={<MailOutcomeBadge outcome={outcome} />}
      note={undeliveredMailNote(outcome, "Sage der Person direkt Bescheid.")}
    />
  );
}

/**
 * The decision mail in a folded row, only when it did not arrive: a mail that
 * arrived needs nobody's look before the row is opened.
 */
export function AbsenceDecisionMailWarning({
  outcome,
}: Readonly<{ outcome?: MailOutcome | null }>) {
  if (!undeliveredMailNote(outcome, "")) return null;
  return (
    <MailOutcomeBadge
      outcome={outcome}
      accessibleLabel="E-Mail zur Entscheidung: "
    />
  );
}

/** The notice of a waiting request to the Leitung, one mail per person. */
export function AbsenceRequestMails({
  counts,
}: Readonly<{ counts?: MailOutcomeCounts | null }>) {
  if (!counts || Object.keys(counts).length === 0) return null;
  return (
    <MailLine
      label="Mail an die Leitung"
      badge={<MailOutcomeBadges counts={counts} envelope />}
      note={undeliveredMailsNote(counts, "Sage der Leitung direkt Bescheid.")}
    />
  );
}
