"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { JumpButton } from "~/components/ui/jump-button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  saveTraegerWithdrawalContact,
  type TraegerContact,
  type TraegerSection,
  type TraegerWithdrawalContact,
} from "~/lib/traeger-api";
import { traegerPath } from "~/lib/traeger-url";
import {
  withdrawalAddressee,
  withdrawalReach,
  withdrawalSender,
  type WithdrawalReachSource,
  type WithdrawalReachValue,
  type WithdrawalSender,
  type WithdrawalSenderSource,
} from "~/lib/traeger-withdrawal-contact";
import { TRAEGER_CONTACT_FIELD_IDS } from "./traeger-contact-card";

const logger = createLogger({ component: "TraegerWithdrawalContactCard" });

interface SourceBadge {
  readonly label: string;
  readonly tone: StatusBadgeTone;
}

const SOURCE_BADGES: Record<WithdrawalReachSource, SourceBadge> = {
  own: { label: "Eigene Angabe", tone: "green" },
  // Framed, so a borrowed value reads on the gray preview panel.
  contact: { label: "Von der Ansprechperson", tone: "outline" },
  missing: { label: "Fehlt", tone: "warning" },
};

// Name and address have one origin, the letterhead (#8131).
const SENDER_BADGES: Record<WithdrawalSenderSource, SourceBadge> = {
  letterhead: { label: "Aus dem Briefkopf", tone: "outline" },
  incomplete: { label: "Anschrift fehlt", tone: "warning" },
  missing: { label: "Fehlt", tone: "warning" },
};

const LETTERHEAD_PATH = "/traeger/einstellungen/briefkopf";

function sameReach(
  a: TraegerWithdrawalContact,
  b: TraegerWithdrawalContact,
): boolean {
  return a.phone === b.phone && a.email === b.email;
}

function fallbackHint(contactValue: string, what: string): string {
  return contactValue === ""
    ? `Bei der Ansprechperson steht keine ${what}.`
    : `Leer lassen: Dann steht hier ${contactValue} von der Ansprechperson.`;
}

/**
 * One value of the notice with its origin under it, and where present the
 * place to change it, so nobody looks for it in the wrong card (#8131).
 */
function SourceField({
  label,
  badge,
  action,
  fullWidth,
  children,
}: Readonly<{
  label: string;
  badge: SourceBadge;
  action?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}>) {
  return (
    <DataField label={label} fullWidth={fullWidth}>
      <span className="block min-w-0 wrap-anywhere">{children}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge label={badge.label} tone={badge.tone} size="xs" />
        {action}
      </span>
    </DataField>
  );
}

function ReachField({
  label,
  reach,
}: Readonly<{ label: string; reach: WithdrawalReachValue }>) {
  return (
    <SourceField label={label} badge={SOURCE_BADGES[reach.source]}>
      {reach.value === "" ? "–" : reach.value}
    </SourceField>
  );
}

/**
 * Name and address of the addressee, from the letterhead. The link opens a
 * new tab: leaving the page would drop what is typed in this form.
 */
function SenderField({
  sender,
  canEdit,
  onOpenLetterhead,
}: Readonly<{
  sender: WithdrawalSender;
  canEdit: boolean;
  /** Marks that the letterhead tab was opened, by click or middle click. */
  onOpenLetterhead: () => void;
}>) {
  const label =
    sender.source === "letterhead"
      ? "Im Briefkopf ändern"
      : "Im Briefkopf eintragen";
  return (
    <SourceField
      label="Name und Anschrift"
      badge={SENDER_BADGES[sender.source]}
      fullWidth
      action={
        canEdit ? (
          <ButtonLink
            href={traegerPath(LETTERHEAD_PATH)}
            newTab
            variant="link"
            size="compact"
            className="gap-1 underline"
            aria-label={label}
            tooltip="Öffnet Briefkopf und Vorlagen in einem neuen Tab."
            onClick={onOpenLetterhead}
            onAuxClick={onOpenLetterhead}
          >
            {label}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </ButtonLink>
        ) : undefined
      }
    >
      {sender.source === "missing" ? (
        "–"
      ) : (
        <>
          {sender.name}
          {sender.address.length > 0 ? (
            <span className="block font-normal text-gray-700">
              {sender.address.join(", ")}
            </span>
          ) : null}
        </>
      )}
    </SourceField>
  );
}

/**
 * Phone and e-mail for withdrawals (#6200): the withdrawal notice of every
 * care contract names them, on the PDF, the signing page, in the mail and in
 * the text the school copies into its enrollment form.
 * An empty field takes the contact person's. The preview shows the notice's
 * sentence as parents read it, with where each value comes from: name and
 * address from the letterhead, never from the contact person (#8131).
 */
export function TraegerWithdrawalContactCard({
  withdrawal,
  version,
  contact,
  letterheadText,
  refreshLetterhead,
  canEdit,
  reload,
  write,
  onSaved,
}: Readonly<{
  withdrawal: TraegerWithdrawalContact;
  /** The section's read state the save sends back (ADR 0311). */
  version: string;
  contact: TraegerContact;
  letterheadText: string;
  /**
   * Reads the letterhead again. Runs when the person comes back from the
   * letterhead tab, so the preview shows what they changed there.
   */
  refreshLetterhead: () => Promise<unknown>;
  canEdit: boolean;
  /** Reads the section again after a refused save; rejects on failure. */
  reload: () => Promise<TraegerSection<TraegerWithdrawalContact>>;
  /** Hands the save answer to the page's read (ADR 0311, rule 5). */
  write?: (
    stored: TraegerSection<TraegerWithdrawalContact>,
  ) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}>) {
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();
  // The reload after saving stands above the card as a load error, never as
  // an error of the form (#6652).
  const afterSave = useRefreshAfterWrite(
    "die Anzeige des Kontakts für Widerrufe",
    onSaved,
  );

  // The draft rests on the section's version (ADR 0311): a refresh after
  // another change on the page refills it only while untouched, the save
  // answer becomes its base, and a refused save shows the stored values.
  const form = useDraftOn<
    TraegerSection<TraegerWithdrawalContact>,
    TraegerWithdrawalContact,
    string,
    TraegerSection<TraegerWithdrawalContact>
  >(
    {
      opening: "withdrawal",
      data: { value: withdrawal, version },
      reload,
      write,
    },
    {
      token: (read) => read.version,
      toDraft: (read) => read.value,
      same: sameReach,
      answer: (saved) => saved,
    },
  );
  const draft = form.draft ?? withdrawal;
  const setDraft = form.setDraft;
  const changed = form.touched;
  const readForm = useReadDraftForm(
    form,
    formErrors,
    "den Kontakt für Widerrufe",
  );
  const reach = withdrawalReach(contact, draft);
  const addressee = withdrawalAddressee(letterheadText, reach);
  const sender = withdrawalSender(letterheadText);
  // Set by the letterhead link. From then on every return to this tab reads
  // the letterhead again: the person may come back before saving there.
  const letterheadOpened = useRef(false);
  useEffect(() => {
    const reread = () => {
      if (!letterheadOpened.current) return;
      // The settings read shows its own load error and retry on the page.
      void refreshLetterhead().catch(() => undefined);
    };
    globalThis.addEventListener("focus", reread);
    return () => globalThis.removeEventListener("focus", reread);
  }, [refreshLetterhead]);
  const missing = [
    reach.phone.source === "missing" ? "Telefonnummer" : null,
    reach.email.source === "missing" ? "E-Mail-Adresse" : null,
  ].filter((value) => value !== null);

  const submit = async () => {
    if (!readForm.begin()) return;
    setSaving(true);
    const result = await form.submit((expected, submitted) =>
      saveTraegerWithdrawalContact(submitted, expected),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("traeger_withdrawal_contact_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      void formErrors.show(result.error, {
        object: "die Änderung des Kontakts für Widerrufe",
        reload: result.reload,
      });
      return;
    }
    success("Der Kontakt für Widerrufe ist gespeichert.");
    await afterSave.refresh();
  };

  return (
    <SectionCard
      title="Kontakt für Widerrufe"
      description="Eltern können einen Vertrag 14 Tage lang widerrufen. Diese Angaben stehen dafür in der Widerrufsbelehrung."
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LoadErrorAlert error={afterSave.error} />
        <LoadErrorAlert error={readForm.loadError} />
        <FormErrorAlert message={formErrors.error} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            controlSize="compact"
            id="traeger-withdrawal-phone"
            label="Telefon für Widerrufe"
            name="phone"
            type="tel"
            value={draft.phone}
            placeholder={contact.phone}
            hint={fallbackHint(contact.phone, "Telefonnummer")}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            error={formErrors.fieldError("phone")}
            maxLength={40}
            disabled={!canEdit}
          />
          <Input
            controlSize="compact"
            id="traeger-withdrawal-email"
            label="E-Mail für Widerrufe"
            name="email"
            type="email"
            value={draft.email}
            placeholder={contact.email}
            hint={fallbackHint(contact.email, "E-Mail-Adresse")}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            error={formErrors.fieldError("email")}
            maxLength={254}
            disabled={!canEdit}
          />
        </div>

        {missing.length > 0 ? (
          <Alert
            type="warning"
            message={`Die Widerrufsbelehrung braucht Telefon und E-Mail. Es fehlt: ${missing.join(" und ")}. Bitte trage sie hier oder bei der Ansprechperson ein.`}
            action={
              canEdit ? (
                <JumpButton
                  targetId={
                    reach.phone.source === "missing"
                      ? TRAEGER_CONTACT_FIELD_IDS.phone
                      : TRAEGER_CONTACT_FIELD_IDS.email
                  }
                  tooltip="Springt zu Telefon und E-Mail der Ansprechperson."
                >
                  Zur Ansprechperson
                </JumpButton>
              ) : undefined
            }
          />
        ) : null}

        <figure aria-label="Vorschau der Widerrufsbelehrung">
          <InsetPanel padding="md" className="space-y-3">
            <SectionLabel as="p">So lesen Eltern die Belehrung</SectionLabel>
            {/* sie-anrede-erlaubt (ADR 0294): Auszug der gesetzlichen Muster-Widerrufsbelehrung, wörtlich. */}
            <blockquote className="text-sm leading-relaxed text-pretty text-gray-700">
              Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (
              <span className="font-medium text-gray-900">
                {addressee.join(", ")}
              </span>
              ) mittels einer eindeutigen Erklärung (z. B. ein mit der Post
              versandter Brief oder E-Mail) über Ihren Entschluss, diesen
              Vertrag zu widerrufen, informieren.
            </blockquote>
            <DataGrid>
              <SenderField
                sender={sender}
                canEdit={canEdit}
                onOpenLetterhead={() => {
                  letterheadOpened.current = true;
                }}
              />
              <ReachField label="Telefon" reach={reach.phone} />
              <ReachField label="E-Mail" reach={reach.email} />
            </DataGrid>
            <div className="space-y-1 border-t border-gray-200 pt-3 text-sm text-pretty text-gray-600">
              <p>
                Eltern widerrufen beim Vertragspartner. Das ist dein Träger,
                darum stehen hier Name und Anschrift aus dem Briefkopf. Der Name
                der Ansprechperson steht nicht in der Belehrung. Nach einer
                Änderung kopiert die Schule die Belehrung neu ins
                Anmeldeformular.
              </p>
              <p>
                Ausnahmen: Nennen die Vertragsbedingungen eines Angebots einen
                anderen Vertragspartner, steht er zuerst. Schließt laut
                „Zuständigkeiten“ eine andere Stelle die Verträge einer Schule,
                nennt die Belehrung dort deren Angaben.
              </p>
            </div>
          </InsetPanel>
        </figure>

        {canEdit && changed ? (
          <EditActions
            onCancel={() => {
              form.discard();
              formErrors.clear();
            }}
            saving={saving}
            saveType="submit"
            disabled={!form.canSubmit}
            disabledReason={readForm.waitReason}
          />
        ) : null}
      </form>
    </SectionCard>
  );
}
