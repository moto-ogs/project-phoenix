"use client";

/**
 * What became of an appointment's e-mails to the guardians (#7058), in the
 * organizer's detail sheet: one row per kind of mail, the mails grouped by
 * result. Only a mail that did not arrive adds a line with the next step.
 * Without any mail the section stays away.
 */

import { MailOutcomeBadges } from "~/components/messaging/message-mail-status";
import { FramedList } from "~/components/ui/framed-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import {
  CHECK_ADDRESS_AT_GUARDIAN,
  undeliveredMailsNote,
  sumMailOutcomeCounts,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  getStaffAppointmentMails,
  type CalendarAppointmentMails,
} from "~/lib/personal-calendar-api";
import { useSwrPollingRecovery } from "~/lib/hooks/use-swr-polling-recovery";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

/** The kinds in the order a family receives them, named like the subject. */
const APPOINTMENT_MAIL_KINDS = [
  ["appointment_published", "Neuer Termin"],
  ["appointment_updated", "Termin geändert"],
  ["appointment_cancelled", "Termin abgesagt"],
  ["appointment_reminder", "Erinnerung"],
] as const;

// SWR pauses the refresh while the tab is hidden.
const POLL_MS = 15_000;

/** The mails of the appointment, refreshed while the page is visible. */
function useAppointmentMails(appointmentId: string) {
  const { data, error, mutate } = useSWRAuth(
    tenantDailyKeys.appointmentMails(appointmentId),
    () => getStaffAppointmentMails(appointmentId),
    { refreshInterval: POLL_MS, keepPreviousData: false },
  );
  useSwrPollingRecovery(error, mutate, POLL_MS);
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    "der Stand der E-Mails",
    () => mutate(),
  );
  return { mails: data ?? null, loadError };
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
    const families = names.length === 1 ? "der Familie" : "den Familien";
    return `Nicht angekommen bei ${list}. Bitte sage ${families} direkt Bescheid. ${CHECK_ADDRESS_AT_GUARDIAN}`;
  }
  return undeliveredMailsNote(
    sumMailOutcomeCounts(Object.values(mails.kinds)),
    "Welche Adresse betroffen ist, siehst du beim Kind unter „Erziehungsberechtigte“.",
  );
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
