"use client";

// Konto-Seite des Träger-Portals (#4693): die Anmelde-Adresse zum Lesen und
// der eigene Name in diesem Träger-Büro, gelesen und bearbeitet wie auf der
// Profilseite der Schul-App (#7416). Den Namen zeigen das
// Exportprotokoll und der Verlauf jeder Rechnung statt einer E-Mail-Adresse.
// Passwort und Code gehören zum moto-Konto und haben hier keine Karte.

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { TrustedDevicesSection } from "~/components/settings/trusted-devices-section";
import { ContrastPreferenceSection } from "~/components/settings/contrast-preference-section";
import { SectionCard } from "~/components/ui/section-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  changeTraegerProfileName,
  fetchTraegerProfile,
  type TraegerProfile,
} from "~/lib/traeger-api";
import {
  OWN_NAME_REQUIRED,
  TRAEGER_NAME_HINT,
  TRAEGER_NAME_MAX_LENGTH,
} from "~/lib/traeger-person-name";

const logger = createLogger({ component: "TraegerAccountPage" });

/** Was die Seite ist und was man dort zuerst tut (#7595). */
const ACCOUNT_INFO =
  "Hier siehst du dein Konto: die E-Mail-Adresse für die Anmeldung und deinen Namen. Trage zuerst bei „Name“ deinen Namen ein. Entfernst du ein Gerät unter „Meine vertrauten Geräte“, fragt moto dort wieder nach dem Code.";

const NAME_FIELD_ID = "traeger-profile-name";

/**
 * The own name, like the profile page of the school app: read first,
 * „Bearbeiten“ opens the field, „Speichern“ saves it (no autosave).
 */
function NameCard({
  name,
  onSaved,
}: Readonly<{
  name: string;
  onSaved: (profile: TraegerProfile) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();

  // Opening the edit state puts the cursor into the field.
  useEffect(() => {
    if (editing) document.getElementById(NAME_FIELD_ID)?.focus();
  }, [editing]);

  const submit = async () => {
    formErrors.clear();
    const trimmed = draft.trim();
    if (!trimmed) {
      formErrors.invalid(OWN_NAME_REQUIRED, { name: OWN_NAME_REQUIRED });
      return;
    }
    setSaving(true);
    let saved: TraegerProfile;
    try {
      saved = await changeTraegerProfileName(trimmed);
    } catch (err) {
      logger.error("traeger_profile_name_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, { object: "Dein Name" });
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
    onSaved(saved);
    success("Dein Name ist gespeichert.");
  };

  return (
    <SectionCard
      title="Name"
      testId="traeger-account-name"
      description={TRAEGER_NAME_HINT}
      actions={
        editing ? undefined : (
          <Button
            type="button"
            variant="outline"
            size="md"
            className="gap-1.5"
            tooltip="Zeigt das Feld, um deinen Namen zu ändern."
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Bearbeiten
          </Button>
        )
      }
    >
      {editing ? (
        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormErrorAlert message={formErrors.error} />
          <Input
            controlSize="compact"
            id={NAME_FIELD_ID}
            label="Dein Name"
            name="name"
            autoComplete="name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            error={formErrors.fieldError("name")}
            maxLength={TRAEGER_NAME_MAX_LENGTH}
            disabled={saving}
            required
          />
          <EditActions
            onCancel={() => {
              setEditing(false);
              setDraft(name);
              formErrors.clear();
            }}
            saving={saving}
            saveType="submit"
            disabled={draft === name}
            disabledReason="Ändere zuerst deinen Namen."
          />
        </form>
      ) : (
        <DataGrid>
          <DataField label="Dein Name" fullWidth>
            {name || "–"}
          </DataField>
        </DataGrid>
      )}
    </SectionCard>
  );
}

export default function TraegerAccountPage() {
  // The header reads the same profile and shows the saved name (#6870).
  const {
    data: profile,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    traegerKeys.profile(),
    fetchTraegerProfile,
    "Dein Konto",
  );
  const invalidateFamily = useInvalidateFamily();

  return (
    <TenantPage
      title="Konto"
      info={ACCOUNT_INFO}
      loading={loading}
      error={error}
    >
      {profile ? (
        <>
          <SectionCard
            title="Anmeldung"
            description="Mit dieser E-Mail-Adresse meldest du dich an."
          >
            <DataGrid>
              <DataField label="E-Mail" fullWidth>
                <span className="wrap-anywhere">{profile.email}</span>
              </DataField>
            </DataGrid>
          </SectionCard>
          <NameCard
            name={profile.name}
            onSaved={(saved) => {
              void mutate(saved, { revalidate: false });
              // „Mitglieder und Rollen“ lists the name too (#4693).
              void invalidateFamily(traegerKeys.buero());
            }}
          />
          <TrustedDevicesSection scope="traeger" />
          <ContrastPreferenceSection portal="traeger" />
        </>
      ) : null}
    </TenantPage>
  );
}
