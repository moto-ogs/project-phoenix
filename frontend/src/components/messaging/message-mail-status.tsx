/**
 * What became of an e-mail moto sent (#7058), as small pills.
 *
 * Two shapes. In the meta line of the OGS's own chat bubble the visible word
 * „E-Mail“ keeps the mail apart from the message in moto: „Gelesen · E-Mail
 * Nicht zustellbar“ never reads as a message that did not arrive. In a
 * labelled line („Mail an die Leitung“, „Neuer Termin“) the pills stand alone
 * and the first carries an envelope. Only a mail that did not arrive adds a
 * line with the next step.
 */

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/ssr";

import { StatusBadge } from "~/components/ui/status-badge";
import {
  CHECK_ADDRESS_AT_GUARDIAN,
  mailNeedsAttention,
  mailOutcomeGroups,
  mailStatusCopy,
  type MailOutcome,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";

function Envelope({ className }: { className?: string }) {
  return <EnvelopeSimpleIcon className={className} weight="bold" aria-hidden />;
}

/**
 * One mail as a pill with an envelope, for a labelled line. `accessibleLabel`
 * names the mail where no label stands beside it.
 */
export function MailOutcomeBadge({
  outcome,
  accessibleLabel,
}: {
  outcome?: MailOutcome | null;
  accessibleLabel?: string;
}) {
  const copy = mailStatusCopy(outcome ?? undefined);
  if (!copy) return null;
  return (
    <StatusBadge
      label={copy.label}
      tone={copy.tone}
      size="xs"
      icon={Envelope}
      accessibleLabel={accessibleLabel}
      data-mail-outcome={outcome ?? undefined}
    />
  );
}

/**
 * Mails counted by result as pills, the one that needs attention first. With
 * `envelope` the first pill carries the envelope, for a labelled line.
 */
export function MailOutcomeBadges({
  counts,
  envelope = false,
  accessibleLabel,
}: {
  counts?: MailOutcomeCounts | null;
  envelope?: boolean;
  accessibleLabel?: string;
}) {
  const groups = mailOutcomeGroups(counts ?? undefined);
  if (groups.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {groups.map((group, index) => (
        <StatusBadge
          key={group.label}
          label={group.label}
          tone={group.tone}
          size="xs"
          icon={envelope && index === 0 ? Envelope : undefined}
          accessibleLabel={index === 0 ? accessibleLabel : undefined}
        />
      ))}
    </span>
  );
}

/** The mail of one message to the one guardian, in the bubble's meta line. */
export function MessageMailBadge({ outcome }: { outcome?: MailOutcome }) {
  const copy = mailStatusCopy(outcome);
  if (!copy) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Envelope className="h-3.5 w-3.5 text-gray-400" />
      <span>E-Mail</span>
      <StatusBadge
        label={copy.label}
        tone={copy.tone}
        size="xs"
        data-mail-outcome={outcome}
      />
    </span>
  );
}

/** The next step when the mail of a conversation message did not arrive. */
export function messageMailNote(outcome?: MailOutcome): string | null {
  const copy = mailStatusCopy(outcome);
  if (!mailNeedsAttention(copy) || !copy?.explanation) return null;
  if (outcome === "undeliverable" || outcome === "complained") {
    return `${copy.explanation} ${CHECK_ADDRESS_AT_GUARDIAN}`;
  }
  return copy.explanation;
}

/** The mails of one group message, one per family, in the bubble's meta line. */
export function GroupMessageMailBadges({
  counts,
}: {
  counts?: MailOutcomeCounts;
}) {
  if (mailOutcomeGroups(counts).length === 0) return null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1"
      data-testid="group-message-mails"
    >
      <Envelope className="h-3.5 w-3.5 text-gray-400" />
      <span>E-Mails</span>
      <MailOutcomeBadges counts={counts} />
    </span>
  );
}

/** The next step when mails of a group message did not arrive. */
export function groupMessageMailNote(
  counts?: MailOutcomeCounts,
): string | null {
  const refused = (counts?.undeliverable ?? 0) + (counts?.complained ?? 0);
  if (refused > 0) {
    return `${refused === 1 ? "Eine Mail kam" : `${refused} Mails kamen`} nicht an. Welche Adresse betroffen ist, sehen Sie beim Kind unter „Erziehungsberechtigte“.`;
  }
  for (const outcome of ["send_failed", "overdue", "delayed"] as const) {
    if (counts?.[outcome]) return mailStatusCopy(outcome)?.explanation ?? null;
  }
  return null;
}
