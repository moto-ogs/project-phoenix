"use client";

/**
 * What became of an appointment's e-mails to the guardians (#7058), in the
 * organizer's detail sheet: one row per kind of mail, the mails grouped by
 * result. Only a mail that did not arrive adds a line with the next step.
 * Without any mail the section stays away.
 */

import { useCallback, useEffect, useState } from "react";

import { MailOutcomeBadges } from "~/components/messaging/message-mail-status";
import { FramedList } from "~/components/ui/framed-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import { useApiLoadError } from "~/contexts/ToastContext";
import {
  CHECK_ADDRESS_AT_GUARDIAN,
  mailsNotArrived,
  sumMailOutcomeCounts,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";
import { createLogger } from "~/lib/logger";
import {
  getStaffAppointmentMails,
  type CalendarAppointmentMails,
} from "~/lib/personal-calendar-api";

const logger = createLogger({ component: "AppointmentMailStatus" });

/** The kinds in the order a family receives them, named like the subject. */
const APPOINTMENT_MAIL_KINDS = [
  ["appointment_published", "Neuer Termin"],
  ["appointment_updated", "Termin geändert"],
  ["appointment_cancelled", "Termin abgesagt"],
  ["appointment_reminder", "Erinnerung"],
] as const;

const POLL_MS = 15_000;

/** The mails of the appointment, refreshed while the page is visible. */
export function useAppointmentMails(appointmentId: string) {
  const [mails, setMails] = useState<CalendarAppointmentMails | null>(null);
  const load = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = load;
  const refresh = useCallback(async () => {
    try {
      setMails(await getStaffAppointmentMails(appointmentId));
      clearLoadError();
    } catch (err) {
      logger.error("appointment_mails_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showLoadError(err, {
        object: "der Stand der E-Mails",
        retry: () => void refresh(),
      });
    }
  }, [appointmentId, showLoadError, clearLoadError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return { mails, loadError: load.error };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count} ${many}`;
}

/**
 * The next step under the mails, or null while every mail is fine. A named
 * guardian is whom to call; without a name the guardian's card shows which
 * address is affected.
 */
export function appointmentMailNote(
  mails: CalendarAppointmentMails | null,
): string | null {
  if (!mails) return null;
  const names = [
    ...new Set(Object.values(mails.not_arrived ?? {}).flat()),
  ].sort((a, b) => a.localeCompare(b, "de"));
  if (names.length > 0) {
    const list = new Intl.ListFormat("de", { type: "conjunction" }).format(
      names,
    );
    return `Nicht angekommen bei ${list}. Bitte informieren Sie sie direkt. ${CHECK_ADDRESS_AT_GUARDIAN}`;
  }
  const total = sumMailOutcomeCounts(Object.values(mails.kinds));
  const missing = mailsNotArrived(total);
  if (missing > 0) {
    return `${plural(missing, "Eine Mail kam", "Mails kamen")} nicht an. Welche Adresse betroffen ist, sehen Sie beim Kind unter „Erziehungsberechtigte“.`;
  }
  const complained = total.complained ?? 0;
  if (complained > 0) {
    return `${plural(complained, "Eine Familie hat", "Familien haben")} die Mail als unerwünscht gemeldet. Bitte sprechen Sie sie direkt an.`;
  }
  const late = total.delayed ?? 0;
  if (late > 0) {
    return `${plural(late, "Eine Mail kommt", "Mails kommen")} später an. moto versucht es weiter.`;
  }
  return null;
}

function hasMails(counts: MailOutcomeCounts | undefined): boolean {
  return Object.values(counts ?? {}).some((count) => (count ?? 0) > 0);
}

/** The organizer's view of the appointment's mails to the guardians. */
export function AppointmentMailStatus({
  appointmentId,
}: Readonly<{ appointmentId: string }>) {
  const { mails, loadError } = useAppointmentMails(appointmentId);
  const rows = APPOINTMENT_MAIL_KINDS.filter(([kind]) =>
    hasMails(mails?.kinds[kind]),
  );
  const note = appointmentMailNote(mails);
  if (!loadError && rows.length === 0) return null;
  return (
    <section
      className="space-y-2 border-t border-gray-200 pt-4"
      aria-labelledby={`appointment-mails-${appointmentId}`}
      data-testid="appointment-mails"
    >
      <SectionLabel as="h4" id={`appointment-mails-${appointmentId}`}>
        E-Mails an die Eltern
      </SectionLabel>
      <LoadErrorAlert error={loadError} actionLayout="responsive" />
      {rows.length > 0 ? (
        <FramedList>
          {rows.map(([kind, label]) => (
            <li
              key={kind}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2"
            >
              <span className="text-sm font-medium text-gray-900">{label}</span>
              <MailOutcomeBadges counts={mails?.kinds[kind]} />
            </li>
          ))}
        </FramedList>
      ) : null}
      {note ? <p className="text-sm text-gray-600">{note}</p> : null}
    </section>
  );
}
