"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { CheckboxCard } from "~/components/ui/checkbox-card";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Skeleton } from "~/components/ui/skeleton";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  bulkInviteGuardians,
  type BulkInviteProblem,
  type BulkInviteResult,
} from "~/lib/guardian-bulk-invite-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { cn } from "~/lib/utils";
import { useFreshSWR } from "~/lib/swr";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";

const logger = createLogger({ component: "SelectionBulkInviteModal" });

const PROBLEM_LABEL: Record<BulkInviteProblem["reason"], string> = {
  missing_email: "E-Mail-Adresse fehlt",
  invalid_email: "E-Mail-Adresse ist falsch geschrieben",
  duplicate_email: "Gleiche E-Mail-Adresse wie eine andere Person",
  email_not_queued: "E-Mail konnte gerade nicht verschickt werden",
  address_blocked: "Mails an diese Person gehen gerade nicht raus",
  mail_delayed: "Die letzte E-Mail ist noch unterwegs",
  provider_blocked: "Diese Adresse ist gesperrt",
  block_unreadable: "Der Stand der Adresse lässt sich gerade nicht prüfen",
};

const PROBLEM_ACTION: Record<BulkInviteProblem["reason"], string> = {
  missing_email: "Trage die E-Mail-Adresse beim Kind ein.",
  invalid_email: "Prüfe die E-Mail-Adresse beim Kind.",
  duplicate_email: "Prüfe die E-Mail-Adressen bei den Eltern.",
  email_not_queued: "Versuche es später noch einmal.",
  address_blocked:
    "Den Grund siehst du beim Kind unter „Erziehungsberechtigte“.",
  mail_delayed: "Bitte warte, sonst kommt die Mail doppelt an.",
  provider_blocked: "Der moto-Support muss das klären.",
  block_unreadable: "Bitte versuche es später noch einmal.",
};

function parents(count: number): string {
  return count === 1 ? "1 Elternteil" : `${count} Eltern`;
}

function invitedNotice(count: number): string {
  return count === 1
    ? "1 Elternteil ist eingeladen."
    : `${count} Eltern sind eingeladen.`;
}

function invitations(result: BulkInviteResult): number {
  return result.invited + result.resent + result.linkedExistingAccount;
}

/** Was der Lauf verschickt: Einladungen und die Nachricht an Eltern mit Konto. */
function mails(result: BulkInviteResult): number {
  return invitations(result) + result.notified;
}

function sentNotice(result: BulkInviteResult): string {
  if (result.notified === 0) return invitedNotice(invitations(result));
  const notified =
    result.notified === 1
      ? "1 Elternteil bekommt die Nachricht."
      : `${result.notified} Eltern bekommen die Nachricht.`;
  return invitations(result) === 0
    ? notified
    : `${invitedNotice(invitations(result))} ${notified}`;
}

function sendLabel(preview: BulkInviteResult | null): string {
  if (!preview || mails(preview) === 0) return "Einladen";
  if (invitations(preview) === 0) {
    return `${parents(preview.notified)} benachrichtigen`;
  }
  return preview.notified > 0
    ? `${parents(mails(preview))} anschreiben`
    : `${parents(mails(preview))} einladen`;
}

/** Eltern mit Konto in der Auswahl: nur dann gibt es die Wahl. */
function hasAccountHolders(preview: BulkInviteResult): boolean {
  return preview.skippedActive + preview.notified > 0;
}

interface SelectionBulkInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentIds: string[];
}

/**
 * Sammeleinladung ins Elternportal für die ausgewählten Kinder (#3378). Der
 * Dialog zählt zuerst nur (dry run) und verschickt erst nach dem Klick.
 * Auf Wunsch bekommen Eltern, die das Elternportal schon nutzen, eine
 * Nachricht, dass die Betreuung ihrer Kinder dort sichtbar ist (#7760): an die
 * Adresse ihres Kontos, nur für Kinder mit heute gebuchter Betreuung, je Kind
 * einmal.
 * Gezählt werden Eltern, nicht Kinder: ein Elternteil mit drei Kindern
 * bekommt eine E-Mail.
 */
export function SelectionBulkInviteModal({
  isOpen,
  onClose,
  studentIds,
}: SelectionBulkInviteModalProps) {
  const { success } = useToast();
  const [sent, setSent] = useState<BulkInviteResult | null>(null);
  const [resendOpen, setResendOpen] = useState(false);
  // Off by default: only on request do parents with an account get mail (#7760).
  const [notifyActive, setNotifyActive] = useState(false);
  const save = useFormModalPending(isOpen);
  const sending = save.pending;
  const errors = useApiFormError();
  // „Wiederholen“ sendet mit der aktuellen Auswahl.
  const latestSendRef = useRef<() => Promise<void>>(async () => undefined);

  // The dry run only counts; nothing is sent until the click below. The
  // button names the counts of this opening's own dry run, never a cached one.
  const previewRead = useFreshSWR(
    isOpen
      ? tenantStudentKeys.bulkInvitePreview(
          studentIds,
          resendOpen,
          notifyActive,
        )
      : null,
    () =>
      bulkInviteGuardians(studentIds, {
        dryRun: true,
        resendOpen,
        notifyActive,
      }),
  );
  const { mutate: mutatePreview } = previewRead;
  // A failed dry run shows its error, not the counts of an earlier one.
  const previewData = previewRead.error ? undefined : previewRead.data;
  const preview = previewData ?? null;
  const load = useSwrResourceLoadError(
    [{ data: previewData, error: previewRead.error }],
    "die Vorschau",
    () => mutatePreview(),
  );

  // While the preview counts again after a choice changed, the last counts
  // stay on screen, marked as busy: both choices keep their place and the
  // keyboard focus, and can be changed back right away. A new opening and a
  // failed count never show earlier counts.
  const [shown, setShown] = useState<BulkInviteResult | null>(null);
  if (!isOpen && shown !== null) setShown(null);
  if (isOpen && preview !== null && preview !== shown) setShown(preview);
  const recounting = preview === null && shown !== null && !load.error;
  const displayed = preview ?? (recounting ? shown : null);

  const toMail = preview ? mails(preview) : 0;

  const handleResendOpenChange = (value: boolean) => {
    errors.clear();
    setResendOpen(value);
  };

  const handleNotifyActiveChange = (value: boolean) => {
    errors.clear();
    setNotifyActive(value);
  };

  const handleSend = async () => {
    await save.run(async (op) => {
      errors.clear();
      try {
        const result = await bulkInviteGuardians(studentIds, {
          dryRun: false,
          resendOpen,
          notifyActive,
        });
        if (op.isCurrent()) {
          setSent(result);
          // The counts of a later opening come from a new dry run.
          void mutatePreview();
        }
        success(sentNotice(result));
      } catch (err) {
        logger.error("bulk_invite_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        await errors.show(err, {
          object: "die Einladung",
          retry: () => void latestSendRef.current(),
        });
      }
    });
  };
  useLayoutEffect(() => {
    latestSendRef.current = handleSend;
  });

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Eltern ins Elternportal einladen"
      size="md"
      mobilePosition="bottom"
      pending={save}
      error={errors.error}
      footer={
        <div className="flex justify-end gap-2 p-4">
          {sent ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              noTooltip="Schließen schließt nur den Dialog, die Einladungen sind schon verschickt."
              onClick={onClose}
            >
              Schließen
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="md"
                noTooltip="Abbrechen schließt nur den Dialog, ohne etwas zu ändern."
                onClick={onClose}
                disabled={sending}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="success"
                size="md"
                onClick={handleSend}
                disabled={sending || toMail === 0}
                tooltip={
                  notifyActive
                    ? "Schickt sofort die Einladungen und die Nachricht an Eltern mit Konto."
                    : "Schickt den Eltern sofort eine E-Mail mit dem Zugang zum Elternportal."
                }
                disabledReason={
                  preview && toMail === 0
                    ? notifyActive
                      ? "In dieser Auswahl bekommt niemand eine E-Mail."
                      : "In dieser Auswahl gibt es niemanden einzuladen."
                    : undefined
                }
              >
                {sending ? "Wird gesendet..." : sendLabel(preview)}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {sent ? (
          <SentSummary result={sent} />
        ) : displayed ? (
          <PreviewSummary
            preview={displayed}
            recounting={recounting}
            childCount={studentIds.length}
            resendOpen={resendOpen}
            onResendOpenChange={handleResendOpenChange}
            notifyActive={notifyActive}
            onNotifyActiveChange={handleNotifyActiveChange}
            disabled={sending}
          />
        ) : load.error ? (
          <LoadErrorAlert error={load.error} />
        ) : (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}
        {(sent ?? displayed)?.problems.length ? (
          <ProblemList
            problems={(sent ?? displayed)?.problems ?? []}
            notifyActive={notifyActive}
          />
        ) : null}
      </div>
    </FormModal>
  );
}

function PreviewSummary({
  preview,
  recounting,
  childCount,
  resendOpen,
  onResendOpenChange,
  notifyActive,
  onNotifyActiveChange,
  disabled,
}: {
  preview: BulkInviteResult;
  recounting: boolean;
  childCount: number;
  resendOpen: boolean;
  onResendOpenChange: (value: boolean) => void;
  notifyActive: boolean;
  onNotifyActiveChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const toMail = invitations(preview);
  const openCount = preview.skippedOpen + preview.resent;
  const missingEmail = preview.problems.filter(
    (problem) => problem.reason === "missing_email",
  ).length;
  // Counts and sentences are dimmed and marked busy while they are counted
  // again; the two choices below stay as they are.
  const counts = recounting ? "opacity-60" : undefined;
  return (
    <>
      <p className={cn("text-sm text-gray-900", counts)} aria-busy={recounting}>
        {toMail === 0 ? (
          "Für diese Auswahl gibt es niemanden einzuladen."
        ) : (
          <>
            <strong>{parents(toMail)}</strong>{" "}
            {toMail === 1 ? "bekommt" : "bekommen"} Zugang zum Elternportal.
            Ausgewählt: {childCount === 1 ? "1 Kind" : `${childCount} Kinder`}.
          </>
        )}
      </p>
      {preview.invited + preview.resent > 0 ? (
        <p className="text-sm text-gray-600">
          Sage den Eltern vorher Bescheid, dass eine E-Mail von moto kommt.
        </p>
      ) : null}
      <ul
        className={cn("space-y-1 text-sm text-gray-700", counts)}
        aria-busy={recounting}
      >
        <CountRow
          label="Vorhandenes moto-Konto wird verbunden"
          count={preview.linkedExistingAccount}
        />
        <CountRow
          label="Nutzen das Elternportal schon"
          count={preview.skippedActive - preview.alreadyNotified}
        />
        <CountRow
          label="Nachricht schon verschickt"
          count={preview.alreadyNotified}
        />
        <CountRow label="Einladung ist noch offen" count={openCount} />
        <CountRow
          label="Nur Kontakt, zum Beispiel abholberechtigt. Wird nicht eingeladen"
          count={preview.skippedRestricted}
        />
      </ul>
      {openCount > 0 ? (
        <label
          htmlFor="bulk-invite-resend-open"
          className="flex cursor-pointer items-start gap-3 text-sm text-gray-800"
        >
          <Checkbox
            id="bulk-invite-resend-open"
            checked={resendOpen}
            disabled={disabled}
            onChange={(event) => onResendOpenChange(event.target.checked)}
          />
          <span>Offene Einladungen noch einmal senden</span>
        </label>
      ) : null}
      {notifyActive || hasAccountHolders(preview) ? (
        <CheckboxCard
          checked={notifyActive}
          disabled={disabled}
          onChange={onNotifyActiveChange}
          label="Eltern mit Konto benachrichtigen"
          hint="Eine kurze E-Mail an die Adresse, mit der sie sich anmelden: Die Betreuung ist jetzt im Elternportal sichtbar. Nur für Kinder, die heute Betreuung gebucht haben, pro Kind nur einmal."
        />
      ) : null}
      {notifyActive ? (
        <ul
          className={cn("space-y-1 text-sm text-gray-700", counts)}
          aria-label="Was verschickt wird"
          aria-busy={recounting}
        >
          <CountRow label="Werden eingeladen" count={toMail} always />
          <CountRow
            label="Bekommen die Nachricht"
            count={preview.notified}
            always
          />
          <CountRow label="Keine E-Mail-Adresse" count={missingEmail} always />
          <CountRow
            label="Kinder ohne gebuchte Betreuung: keine Nachricht"
            count={preview.withoutVisibleCare}
          />
        </ul>
      ) : null}
    </>
  );
}

function CountRow({
  label,
  count,
  always = false,
}: {
  label: string;
  count: number;
  always?: boolean;
}) {
  if (count === 0 && !always) return null;
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span>{label}</span>
      <span className="font-semibold text-gray-900 tabular-nums">{count}</span>
    </li>
  );
}

function SentSummary({ result }: { result: BulkInviteResult }) {
  const messages = [
    result.invited > 0
      ? `Die Einladung an ${parents(result.invited)} wird jetzt verschickt.`
      : null,
    result.resent > 0
      ? `Die Einladung an ${parents(result.resent)} wird noch einmal verschickt.`
      : null,
    result.linkedExistingAccount > 0
      ? `Der Hinweis an ${parents(result.linkedExistingAccount)} mit moto-Konto wird jetzt verschickt.`
      : null,
    result.notified > 0
      ? `Die Nachricht an ${parents(result.notified)} mit Konto wird jetzt verschickt.`
      : null,
  ].filter((message): message is string => message !== null);
  const summary =
    messages.length > 0
      ? `${messages.join(" ")} Das dauert ein paar Minuten.`
      : "Es wurde keine E-Mail eingeplant.";
  return (
    <div className="space-y-2">
      <Alert type="success" message={summary} />
      {result.withoutVisibleCare > 0 ? (
        <p className="text-sm text-gray-700">
          {result.withoutVisibleCare === 1
            ? "1 Kind hat heute keine Betreuung gebucht. Dafür geht keine Nachricht raus."
            : `${result.withoutVisibleCare} Kinder haben heute keine Betreuung gebucht. Für sie geht keine Nachricht raus.`}
        </p>
      ) : null}
      {result.alreadyNotified > 0 ? (
        <p className="text-sm text-gray-700">
          Die Nachricht an {parents(result.alreadyNotified)} mit Konto ist schon
          verschickt. Es geht keine zweite raus.
        </p>
      ) : null}
      {result.linkedExistingAccount > 0 ? (
        <p className="text-sm text-gray-700">
          {parents(result.linkedExistingAccount)} mit vorhandenem moto-Konto:
          Zugang ist freigeschaltet.
        </p>
      ) : null}
    </div>
  );
}

function ProblemList({
  problems,
  notifyActive,
}: {
  problems: BulkInviteProblem[];
  notifyActive: boolean;
}) {
  const verb = notifyActive
    ? "keine E-Mail bekommen"
    : "nicht eingeladen werden";
  return (
    <div className="space-y-2">
      <Alert
        type="warning"
        message={`${parents(problems.length)} ${problems.length === 1 ? "kann" : "können"} ${verb}. Prüfe die Hinweise bei den Eltern.`}
      />
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-gray-700">
        {problems.map((problem) => (
          <li key={problem.guardianProfileId}>
            <span className="font-medium text-gray-900">
              {problem.guardianName || "Ohne Namen"}
            </span>
            {problem.studentNames.length > 0
              ? ` (${problem.studentNames.join(", ")})`
              : ""}
            : {PROBLEM_LABEL[problem.reason]}.{" "}
            <span>{PROBLEM_ACTION[problem.reason]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
