"use client";

// Konto-Seite des Caterer-Portals (#4496): die Anmelde-Adresse, „Passwort
// ändern“ und die freiwillige Zwei-Faktor-Anmeldung (#4497) mit Passkeys und
// gemerkten Geräten. Jeder Bereich ist eine eigene Karte.

import { useState } from "react";
import { useSession } from "next-auth/react";
import { TenantPasswordChangeModal } from "~/components/auth/tenant-password-change-modal";
import { PasskeySettingsSection } from "~/components/settings/passkey-settings-section";
import { TrustedDevicesSection } from "~/components/settings/trusted-devices-section";
import { ContrastPreferenceSection } from "~/components/settings/contrast-preference-section";
import { EmailCodeFactorSection } from "~/components/settings/email-code-factor-section";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { emailCodeFactorApi } from "~/lib/email-code-factor-api";
import { markPasswordChanged } from "~/lib/login-session-notice";
import { useShellAuth } from "~/lib/shell-auth-context";

const catererMFA = emailCodeFactorApi("caterer");

export default function CatererAccountPage() {
  const { data: session } = useSession();
  const { logout } = useShellAuth();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Anmeldung"
        description="Mit dieser E-Mail-Adresse meldest du dich an."
      >
        <DataGrid>
          <DataField label="E-Mail" fullWidth>
            {session?.user?.email ?? "–"}
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

      <EmailCodeFactorSection
        api={catererMFA}
        onEnabledChange={setMfaEnabled}
      />
      <PasskeySettingsSection scope="caterer" />
      {mfaEnabled && <TrustedDevicesSection scope="caterer" />}
      <ContrastPreferenceSection portal="caterer" />

      <TenantPasswordChangeModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        portal="caterer"
        // The change ended every session of the account, this one too. If the
        // logout request itself fails, the revoked session still opens
        // nothing; its next request ends it (#5194).
        onSuccess={() => {
          markPasswordChanged();
          void logout().catch(() => undefined);
        }}
      />
    </div>
  );
}
