"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { ConfirmationModal } from "~/components/ui/modal";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { hasPermission } from "~/lib/auth-utils";
import {
  ENROLLMENT_ENABLED_KEY,
  ENROLLMENT_NOTIFICATION_EMAILS_KEY,
  ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH,
  ENROLLMENT_PRIVACY_NOTICE_WHO_ACTS,
} from "~/lib/enrollment-privacy-notice";
import { fetchSchoolContactEmail } from "~/lib/settings-api";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useTenantRouter } from "~/lib/tenant-router";

interface EnrollmentActivationDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Whether parents would see a privacy notice (switch on and text). */
  readonly noticePresent: boolean;
  /** The recipients stored today; empty means none. */
  readonly currentRecipients: string;
  readonly onSave: (key: string, value: unknown) => Promise<void>;
}

/**
 * Switching the online enrollment on (#7176). Without a privacy notice the
 * dialog says so and leads to it: the backend refuses the switch then. With
 * one, it asks who gets an e-mail about new enrollments, prefilled with the
 * school's contact address. The field may stay empty.
 */
export function EnrollmentActivationDialog({
  isOpen,
  onClose,
  noticePresent,
  currentRecipients,
  onSave,
}: EnrollmentActivationDialogProps) {
  if (!isOpen) return null;
  return noticePresent ? (
    <RecipientsStep
      onClose={onClose}
      currentRecipients={currentRecipients}
      onSave={onSave}
    />
  ) : (
    <MissingNoticeStep onClose={onClose} />
  );
}

function MissingNoticeStep({ onClose }: Readonly<{ onClose: () => void }>) {
  const { data: session } = useSession();
  const router = useTenantRouter();
  const canWriteNotice = hasPermission(session, "config:manage");
  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => {
        onClose();
        router.push(ENROLLMENT_PRIVACY_NOTICE_SETTINGS_PATH);
      }}
      title="Zuerst die Datenschutzinformation eintragen"
      confirmText="Zur Datenschutzinformation"
      confirmTooltip="Öffnet die Datenschutzinformation unter „Rechtstexte“."
      isConfirmDisabled={!canWriteNotice}
      confirmDisabledReason={ENROLLMENT_PRIVACY_NOTICE_WHO_ACTS}
      cancelText="Abbrechen"
    >
      <p className="text-sm text-gray-600">
        Eltern müssen bei der Anmeldung eine Datenschutzinformation lesen. Sie
        fehlt noch.{" "}
        {canWriteNotice
          ? "Schalte unter „Rechtstexte“ die Datenschutzinformation ein und trage den Text ein. Danach kannst du die Online-Anmeldung einschalten."
          : ENROLLMENT_PRIVACY_NOTICE_WHO_ACTS}
      </p>
    </ConfirmationModal>
  );
}

function RecipientsStep({
  onClose,
  currentRecipients,
  onSave,
}: Readonly<{
  onClose: () => void;
  currentRecipients: string;
  onSave: (key: string, value: unknown) => Promise<void>;
}>) {
  // Without stored recipients the school's contact address is the proposal.
  // A failed read stays silent on purpose: it is only a proposal, the field
  // stays empty and the person can type an address or leave it empty.
  const contactRead = useSWRAuth(
    currentRecipients.trim() === ""
      ? tenantAdminKeys.schoolContactEmail()
      : null,
    () => fetchSchoolContactEmail(),
  );
  // null until the person types: until then the field shows the proposal.
  const [edited, setEdited] = useState<string | null>(null);
  const recipients =
    edited ??
    (currentRecipients.trim() === ""
      ? (contactRead.data ?? "")
      : currentRecipients);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const errors = useApiFormError(formRef);
  const { success: toastSuccess } = useToast();

  const confirm = async () => {
    errors.clear();
    setSaving(true);
    try {
      // Save recipients before publishing the form. A failed recipient write
      // must never leave enrollment enabled without the requested recipients.
      const next = recipients.trim();
      if (next !== currentRecipients.trim()) {
        await onSave(ENROLLMENT_NOTIFICATION_EMAILS_KEY, next);
      }
      await onSave(ENROLLMENT_ENABLED_KEY, true);
      toastSuccess("Die Online-Anmeldung ist eingeschaltet.");
      onClose();
    } catch (error) {
      void errors.show(error, { object: "die Online-Anmeldung" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmationModal
      isOpen
      onClose={() => {
        if (saving) return;
        onClose();
      }}
      onConfirm={() => void confirm()}
      title="Online-Anmeldung einschalten"
      confirmText="Einschalten"
      confirmTooltip="Schaltet den Anmeldelink für Eltern sofort frei."
      cancelText="Abbrechen"
      isConfirmLoading={saving}
      loadingText="Wird eingeschaltet …"
    >
      <div ref={formRef} className="space-y-3">
        <FormErrorAlert message={errors.error} />
        <Input
          label="Empfänger für neue Anmeldungen"
          hint="Diese Adressen bekommen bei jeder neuen Anmeldung eine E-Mail. Mehrere Adressen trennst du mit einem Komma. Das Feld darf leer bleiben."
          type="text"
          inputMode="email"
          autoComplete="email"
          value={recipients}
          onChange={(event) => {
            setEdited(event.target.value);
            errors.clear();
          }}
        />
      </div>
    </ConfirmationModal>
  );
}
