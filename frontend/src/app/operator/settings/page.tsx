"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { Pencil } from "lucide-react";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { PasswordChangeModal } from "~/components/auth/password-change-modal";
import { TenantPage } from "~/components/ui/tenant-page";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { apiErrorFromResponse } from "~/lib/api-error";
import type { ApiResponse } from "~/lib/api-envelope";
import type * as operatorProfileContract from "~/lib/contract/operator-profile.generated";
import { getSessionPersonName } from "~/lib/auth-utils";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { sessionFetch } from "~/lib/session-cache";
import { useSWRAuth } from "~/lib/swr";
import { markPasswordChanged } from "~/lib/login-session-notice";
import { useShellAuth } from "~/lib/shell-auth-context";
import { operatorKeys } from "~/lib/swr/operator-keys";
import { TrustedDevicesSection } from "~/components/settings/trusted-devices-section";
import { PasskeySettingsSection } from "~/components/settings/passkey-settings-section";

const logger = createLogger({ component: "OperatorSettingsPage" });

async function fetchOperatorProfile(): Promise<operatorProfileContract.OperatorResponse> {
  const response = await sessionFetch("/api/operator/profile", {
    method: "GET",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Operator profile load failed (${response.status})`,
    );
  }
  const json =
    (await response.json()) as ApiResponse<operatorProfileContract.OperatorResponse>;
  return json.data;
}

function isEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && value.includes("@");
}

const operatorSettingsLoadingFallback = (
  <TenantPage
    title="Profil"
    loading
    loadingLabel="Profileinstellungen werden geladen"
  />
);

function OperatorSettingsContent() {
  const { data: session, status, update: updateSession } = useSession();
  const { success: toastSuccess } = useToast();
  const { logout } = useShellAuth();
  // An address is never a name (#7305); it stays in the email field only.
  const sessionName = getSessionPersonName(session);
  const sessionEmail = session?.user?.email ?? "";

  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState("");
  const {
    data: profileData,
    error: profileError,
    mutate: mutateProfile,
  } = useSWRAuth(operatorKeys.profile(), fetchOperatorProfile);
  const profileLoad = useSwrResourceLoadError(
    [{ data: profileData, error: profileError }],
    "das Profil",
    () => mutateProfile(),
  );
  // Without the profile the session stands in. The profile form must not
  // show token subjects like "operator:2" as an email address.
  const displayName = profileData?.display_name ?? sessionName;
  const email =
    profileData?.email ?? (isEmail(sessionEmail) ? sessionEmail : "");
  const profileFormRef = useRef<HTMLDivElement>(null);
  const profileErrors = useApiFormError(profileFormRef);
  const { show: showProfileError, clear: clearProfileError } = profileErrors;

  // E-Mail-Wechsel: eigener Ablauf mit Passwortabfrage und Bestätigungslink,
  // darum ein eigener Dialog, der unabhängig vom Bearbeiten-Zustand der
  // Stammdaten erreichbar ist (#3117).
  const [showEmailChangeDialog, setShowEmailChangeDialog] = useState(false);
  const emailFormRef = useRef<HTMLFormElement>(null);
  const emailChangeErrors = useApiFormError(emailFormRef);
  // The kit dialog may not import contexts; this page hands it the shared
  // form error path (#2519). A wrong current password answers 400 with a
  // field error, so no credential mapping is needed here.
  const passwordFormRef = useRef<HTMLFormElement>(null);
  const passwordErrors = useApiFormError(passwordFormRef);
  const { show: showEmailChangeError, clear: clearEmailChangeError } =
    emailChangeErrors;
  const emailChange = useFormModalPending(showEmailChangeDialog);
  const emailChangeLoading = emailChange.pending;
  const [emailChangeNewEmail, setEmailChangeNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");

  const handleClosePasswordModal = useCallback(() => {
    setShowPasswordModal(false);
  }, []);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    clearProfileError();
    try {
      const response = await sessionFetch("/api/operator/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: draftDisplayName }),
      });

      if (!response.ok) {
        throw await apiErrorFromResponse(
          response,
          `Operator profile update failed (${response.status})`,
        );
      }

      const { data: updatedProfile } =
        (await response.json()) as ApiResponse<operatorProfileContract.OperatorResponse>;
      await mutateProfile(updatedProfile, { revalidate: false });
      await updateSession({
        name: updatedProfile.display_name,
        email: updatedProfile.email,
      });

      setIsEditing(false);
      toastSuccess("Profil erfolgreich aktualisiert", { duration: 3000 });
    } catch (err) {
      logger.warn("operator_profile_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showProfileError(err, { object: "das Profil" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseEmailDialog = () => {
    setShowEmailChangeDialog(false);
    clearEmailChangeError();
    setEmailChangeNewEmail("");
    setEmailChangePassword("");
  };

  const handleEmailChange = async () => {
    if (!emailChangeNewEmail || !emailChangePassword) return;
    await emailChange.run(async (op) => {
      clearEmailChangeError();
      try {
        const response = await sessionFetch(
          "/api/operator/profile/email-change",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              new_email: emailChangeNewEmail,
              current_password: emailChangePassword,
            }),
          },
        );

        if (!response.ok) {
          throw await apiErrorFromResponse(
            response,
            `Operator email change failed (${response.status})`,
          );
        }

        const confirmedEmail = emailChangeNewEmail;
        if (op.isCurrent()) handleCloseEmailDialog();
        toastSuccess(
          `Eine Bestätigungs-E-Mail wird an ${confirmedEmail} gesendet. Bitte überprüfe dein Postfach.`,
          { duration: 3000 },
        );
      } catch (err) {
        logger.warn("operator_email_change_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void showEmailChangeError(err, {
          object: "die Änderung der E-Mail-Adresse",
        });
      }
    });
  };

  if (status === "loading") {
    return operatorSettingsLoadingFallback;
  }

  const emailChangeReady =
    !emailChangeLoading && !!emailChangeNewEmail && !!emailChangePassword;

  return (
    <TenantPage
      title="Profil"
      leading={
        <Avatar name={isEditing ? draftDisplayName : displayName} size="lg" />
      }
      overlays={
        <>
          {showPasswordModal && (
            <PasswordChangeModal
              isOpen={showPasswordModal}
              onClose={handleClosePasswordModal}
              apiEndpoint="/api/operator/profile/password"
              errorPath={passwordErrors}
              formRef={passwordFormRef}
              // The change ended every operator session, this one too (the
              // backend revokes all families). Sign out to the login, which
              // asks for the new password. If the logout request fails, the
              // revoked session still opens nothing (#5194).
              onSuccess={() => {
                handleClosePasswordModal();
                markPasswordChanged();
                void logout().catch(() => undefined);
              }}
            />
          )}

          <FormModal
            isOpen={showEmailChangeDialog}
            onClose={handleCloseEmailDialog}
            title="E-Mail-Adresse ändern"
            size="sm"
            mobilePosition="center"
            pending={emailChange}
            error={emailChangeErrors.error}
            footer={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={handleCloseEmailDialog}
                  disabled={emailChangeLoading}
                >
                  Abbrechen
                </Button>
                <Button
                  form="operator-email-change-form"
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={!emailChangeReady}
                >
                  {emailChangeLoading
                    ? "Wird gesendet..."
                    : "E-Mail-Änderung anfordern"}
                </Button>
              </>
            }
          >
            <form
              ref={emailFormRef}
              id="operator-email-change-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleEmailChange();
              }}
            >
              <Input
                id="operator-new-email"
                label="Neue E-Mail-Adresse"
                name="new_email"
                error={emailChangeErrors.fieldError("new_email")}
                type="email"
                required
                autoFocus
                autoComplete="email"
                pattern="[A-Za-z0-9._+%\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]+"
                title="Bitte gib eine gültige E-Mail-Adresse ein (z.B. name@beispiel.de)"
                value={emailChangeNewEmail}
                onChange={(e) => setEmailChangeNewEmail(e.target.value)}
                placeholder="neue@email.de"
              />
              <Input
                id="operator-current-password"
                label="Aktuelles Passwort"
                name="current_password"
                error={emailChangeErrors.fieldError("current_password")}
                type="password"
                required
                autoComplete="current-password"
                value={emailChangePassword}
                onChange={(e) => setEmailChangePassword(e.target.value)}
              />
            </form>
          </FormModal>
        </>
      }
    >
      <LoadErrorAlert error={profileLoad.error} />

      <SectionCard
        title="Persönliche Daten"
        actions={
          isEditing ? undefined : (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => {
                setDraftDisplayName(displayName);
                setIsEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Bearbeiten
            </Button>
          )
        }
      >
        {isEditing ? (
          <div ref={profileFormRef} className="space-y-4">
            <FormErrorAlert message={profileErrors.error} />
            <Input
              id="settings-displayname"
              label="Anzeigename"
              name="display_name"
              error={profileErrors.fieldError("display_name")}
              type="text"
              value={draftDisplayName}
              onChange={(e) => setDraftDisplayName(e.target.value)}
              maxLength={255}
            />
            <EditActions
              onCancel={() => {
                setIsEditing(false);
                clearProfileError();
              }}
              onSave={() => void handleSaveProfile()}
              saving={isSaving}
            />
          </div>
        ) : (
          <DataGrid>
            <DataField label="Anzeigename" fullWidth>
              {displayName || "–"}
            </DataField>
          </DataGrid>
        )}
      </SectionCard>

      <SectionCard
        title="E-Mail-Adresse"
        description="Die neue Adresse gilt erst, nachdem du den Link in der Bestätigungs-E-Mail geöffnet hast."
        actions={
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setShowEmailChangeDialog(true)}
          >
            E-Mail ändern
          </Button>
        }
      >
        <DataGrid>
          <DataField label="E-Mail" fullWidth>
            {email || "–"}
          </DataField>
        </DataGrid>
      </SectionCard>

      <SectionCard
        title="Passwort"
        description="Nach dem Ändern meldest du dich auf allen Geräten neu an."
        actions={
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setShowPasswordModal(true)}
          >
            Passwort ändern
          </Button>
        }
      />

      <PasskeySettingsSection scope="operator" />
      <TrustedDevicesSection scope="operator" />
    </TenantPage>
  );
}

export default function OperatorSettingsPage() {
  return (
    <Suspense fallback={operatorSettingsLoadingFallback}>
      <OperatorSettingsContent />
    </Suspense>
  );
}
