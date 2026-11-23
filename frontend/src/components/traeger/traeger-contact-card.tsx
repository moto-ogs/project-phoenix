"use client";

import { useRef, useState } from "react";
import { EditActions } from "~/components/ui/edit-actions";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  saveTraegerContact,
  type TraegerContact,
  type TraegerSection,
} from "~/lib/traeger-api";

const logger = createLogger({ component: "TraegerContactCard" });

function sameContact(a: TraegerContact, b: TraegerContact): boolean {
  return a.name === b.name && a.phone === b.phone && a.email === b.email;
}

/** The contact's phone and e-mail fields; the withdrawal card jumps to them (#7054). */
export const TRAEGER_CONTACT_FIELD_IDS = {
  phone: "traeger-contact-phone",
  email: "traeger-contact-email",
} as const;

/**
 * The contact person of the Träger (#4653): who parents and schools reach
 * about a letter. Empty fields are left off the letter.
 */
export function TraegerContactCard({
  contact,
  version,
  canEdit,
  reload,
  write,
  onSaved,
}: Readonly<{
  contact: TraegerContact;
  /** The section's read state the save sends back (ADR 0311). */
  version: string;
  canEdit: boolean;
  /** Reads the contact again after a refused save; rejects on failure. */
  reload: () => Promise<TraegerSection<TraegerContact>>;
  /** Hands the save answer to the page's read (ADR 0311, rule 5). */
  write?: (stored: TraegerSection<TraegerContact>) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}>) {
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();
  // The reload after saving stands above the card as a load error, never as
  // an error of the form (#6652).
  const afterSave = useRefreshAfterWrite(
    "die Anzeige der Ansprechperson",
    onSaved,
  );

  // The draft rests on the section's version (ADR 0311): a refresh after
  // another change on the page refills it only while untouched, the save
  // answer (trimmed, e-mail in lower case) becomes its base, and a refused
  // save shows the stored contact instead of the draft.
  const form = useDraftOn<
    TraegerSection<TraegerContact>,
    TraegerContact,
    string,
    TraegerSection<TraegerContact>
  >(
    { opening: "contact", data: { value: contact, version }, reload, write },
    {
      token: (read) => read.version,
      toDraft: (read) => read.value,
      same: sameContact,
      answer: (saved) => saved,
    },
  );
  const draft = form.draft ?? contact;
  const setDraft = form.setDraft;
  const changed = form.touched;
  const loadError = useReadDraftLoadError(form, "die Ansprechperson");

  const submit = async () => {
    if (!form.canSubmit) return;
    formErrors.clear();
    setSaving(true);
    const result = await form.submit((expected, submitted) =>
      saveTraegerContact(submitted, expected),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("traeger_contact_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      void formErrors.show(result.error, {
        object: "die Änderung der Ansprechperson",
        reload: result.reload,
      });
      return;
    }
    success("Die Ansprechperson ist gespeichert.");
    await afterSave.refresh();
  };

  return (
    <SectionCard
      title="Ansprechperson"
      description="An diese Person wenden sich Eltern und Schulen bei Fragen zu einem Brief. Leere Felder stehen nicht auf dem Brief."
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LoadErrorAlert error={afterSave.error} />
        {formErrors.error ? null : <LoadErrorAlert error={loadError} />}
        <FormErrorAlert message={formErrors.error} />
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            controlSize="compact"
            id="traeger-contact-name"
            label="Name"
            name="name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            error={formErrors.fieldError("name")}
            maxLength={120}
            disabled={!canEdit}
          />
          <Input
            controlSize="compact"
            id={TRAEGER_CONTACT_FIELD_IDS.phone}
            label="Telefon"
            name="phone"
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            error={formErrors.fieldError("phone")}
            maxLength={40}
            disabled={!canEdit}
          />
          <Input
            controlSize="compact"
            id={TRAEGER_CONTACT_FIELD_IDS.email}
            label="E-Mail-Adresse"
            name="email"
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            error={formErrors.fieldError("email")}
            maxLength={254}
            disabled={!canEdit}
          />
        </div>
        {canEdit && changed ? (
          <EditActions
            onCancel={() => {
              form.discard();
              formErrors.clear();
            }}
            saving={saving}
            saveType="submit"
            disabled={!form.canSubmit}
          />
        ) : null}
      </form>
    </SectionCard>
  );
}
