// Mails of a holiday registration that did not reach the parents (#6737,
// #6976): receipt, acceptance, place, closing day notice and parent account
// offer. The office learns it here, so it can check the address and reach
// the family another way.

import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { JumpButton } from "~/components/ui/jump-button";
import { StatusBadge } from "~/components/ui/status-badge";
import type { MailOutcome } from "~/lib/email-delivery-status";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchHolidayRegistrationMailProblems,
  type HolidayRegistrationMailKind,
  type HolidayRegistrationMailProblem,
} from "~/lib/traeger-holiday-registrations-api";

type MailProblems = ReadonlyMap<
  string,
  readonly HolidayRegistrationMailProblem[]
>;
const NO_MAIL_PROBLEMS: MailProblems = new Map();

/**
 * The undelivered mails of the registrations of a period, by registration
 * ID. Empty while it loads and when the read fails. `reload` (for example the
 * IDs and states of the loaded registrations) asks again when it changes.
 */
export function useHolidayRegistrationMailProblems(
  periodId: string,
  reload: string,
): MailProblems {
  // Silent on purpose: the list stays complete without the mail states.
  const problems = useTraegerResource(
    periodId && reload !== ""
      ? traegerKeys.holidayMailProblems(periodId, reload)
      : null,
    () => fetchHolidayRegistrationMailProblems(periodId),
    "die Zustellung der Mails",
  ).data;
  return problems ?? NO_MAIL_PROBLEMS;
}

export const HOLIDAY_MAIL_LABELS: Readonly<
  Record<HolidayRegistrationMailKind, string>
> = {
  holiday_registration_received: "Eingangsbestätigung",
  holiday_registration_accepted: "Annahme-Mail",
  holiday_place_granted: "Mail zum Ferienplatz",
  holiday_closure_notice: "Mail zu Schließtagen",
  holiday_parent_account_offer: "Mail zum Elternkonto",
};

/** The name of a mail in a list, as „Eingangsbestätigung“ (#6976). */
function holidayMailLabel(kind: HolidayRegistrationMailKind): string {
  return HOLIDAY_MAIL_LABELS[kind] ?? "Mail";
}

// Only these outcomes can come from a wrong address: the mail came back, or
// the address was held because of an earlier mail (#6999). A complaint or an
// unsubscription came from the parents themselves, a school's stop holds
// the person and not the address, and a failed send says nothing about it.
const ADDRESS_OUTCOMES: ReadonlySet<MailOutcome> = new Set([
  "undeliverable",
  "blocked",
  "provider_blocked",
]);

/**
 * What the office does next (#6999). The phone always helps. Changing the
 * address helps only when it may be wrong, and only while the registration
 * can still be changed: a cancelled one cannot.
 */
function holidayMailNextStep(
  outcomes: readonly MailOutcome[],
  cancelled: boolean,
): string {
  const call = "Informiere die Familie am besten per Telefon.";
  if (cancelled || !outcomes.some((outcome) => ADDRESS_OUTCOMES.has(outcome))) {
    return call;
  }
  return `${call} Prüfe die E-Mail-Adresse unter „Eltern“ und ändere sie, wenn sie falsch ist.`;
}

/** One sentence per mail: which mail and what became of it. */
function holidayMailProblemText(
  problem: HolidayRegistrationMailProblem,
): string {
  const mail = `die ${holidayMailLabel(problem.kind)}`;
  const Mail = mail.charAt(0).toUpperCase() + mail.slice(1);
  switch (problem.state) {
    case "blocked":
      return `${Mail} wurde nicht gesendet. An diese Adresse gehen zurzeit keine Mails.`;
    case "unknown":
      return `Ob ${mail} angekommen ist, ist unklar.`;
    // These mails arrived; the parents refused them afterwards (#6976).
    case "complained":
      return `Die Eltern haben ${mail} als unerwünscht gemeldet.`;
    case "unsubscribed":
      return `Nach der ${holidayMailLabel(problem.kind)} haben sich die Eltern von den Mails abgemeldet.`;
    default:
      return `${Mail} hat die Eltern nicht erreicht.`;
  }
}

/**
 * The notice in the registration: every mail with a problem and what to do.
 * It is the one place for the next step; the list of mails below only shows
 * each mail's status (#6999).
 */
export function HolidayRegistrationMailProblemsAlert({
  problems,
  outcomes,
  cancelled,
  parentsSectionId,
  revealParents,
}: Readonly<{
  problems: readonly HolidayRegistrationMailProblem[];
  /** What became of each mail; it decides whether the address may be wrong. */
  outcomes: readonly MailOutcome[];
  cancelled: boolean;
  /**
   * The card with the parents' phone and address. Both next steps happen
   * there, so the notice leads to it (#6999).
   */
  parentsSectionId: string;
  /** Shows the parents' card first when another tab holds it (#7410). */
  revealParents?: () => void;
}>) {
  if (problems.length === 0) return null;
  return (
    <Alert
      action={
        <JumpButton
          targetId={parentsSectionId}
          reveal={revealParents}
          tooltip="Springt zu Telefon und E-Mail-Adresse der Eltern."
        >
          Zu den Eltern
        </JumpButton>
      }
      type="warning"
      title={
        problems.length === 1
          ? "Mail an die Eltern prüfen"
          : "Mails an die Eltern prüfen"
      }
      message={
        <>
          {problems.map((problem, index) => (
            <span key={`${problem.kind}-${index}`} className="block">
              {holidayMailProblemText(problem)}
            </span>
          ))}
          <span className="mt-1 block">
            {holidayMailNextStep(outcomes, cancelled)}
          </span>
        </>
      }
    />
  );
}

/** The mark in the list: at least one mail did not reach the parents. */
export function HolidayRegistrationMailProblemBadge({
  problems,
}: Readonly<{ problems: readonly HolidayRegistrationMailProblem[] }>) {
  if (problems.length === 0) return null;
  return <StatusBadge tone="warning" label="Mail prüfen" />;
}
