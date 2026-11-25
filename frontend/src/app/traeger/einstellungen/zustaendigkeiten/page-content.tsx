"use client";

// Zuständigkeiten (#4811): wer an den Schulen des Trägers Verträge schließt,
// mit den Eltern abrechnet und das Personal anstellt: der Träger, der
// Schulträger oder die Gemeinde. Oben der Wert für alle Schulen (eine
// Träger-Einstellung, ADR 0086), darunter je Schule, wer wirklich zuständig
// ist. Die Angaben zu Schulträger und Gemeinde stehen bei der Schule.

import { useCallback } from "react";
import { useSession } from "next-auth/react";
import { SettingsCategory } from "~/components/settings/settings-category";
import { BillingIssuerChecklists } from "~/components/traeger/billing-issuer-checklist";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { ResponsibilitySchoolsCard } from "~/components/traeger/responsibility-schools-card";
import { useTraegerResponsibilities } from "~/components/traeger/use-traeger-responsibilities";
import { useTraegerSettingsSchema } from "~/components/traeger/use-traeger-resources";
import { Alert } from "~/components/ui/alert";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { hasPermission } from "~/lib/auth-utils";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  clearTraegerSettingValue,
  saveTraegerSettingValue,
} from "~/lib/traeger-api";
import {
  RESPONSIBILITY_SETTINGS_TAB,
  responsibilityGap,
} from "~/lib/traeger-responsibilities-api";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";

const logger = createLogger({ component: "TraegerResponsibilitiesPage" });

const SETTINGS_RIGHT = "traeger_settings:manage";

const INFO =
  "Hier legst du fest, wer Verträge schließt, abrechnet und Personal anstellt: dein Träger, der Schulträger oder die Gemeinde. Die Wahl gilt für neue Verträge und Schreiben. Schon verschickte bleiben, wie sie sind.";

export default function TraegerResponsibilitiesPage() {
  const { data: session } = useSession();
  const canEdit = hasPermission(session ?? null, SETTINGS_RIGHT);
  const schema = useTraegerSettingsSchema();
  const schools = useTraegerResponsibilities();
  const reloadSchools = schools.reload;
  const mutateSchema = schema.mutate;
  // The Träger value changes what every school without its own value shows.
  const invalidateFamily = useInvalidateFamily();
  // A body bills or stops billing with the value: its checklist follows.
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Zuständigkeiten",
    useCallback(
      () =>
        Promise.all([
          mutateSchema(),
          reloadSchools(),
          invalidateFamily(traegerKeys.billingIssuers()),
        ]),
      [mutateSchema, reloadSchools, invalidateFamily],
    ),
  );
  const refresh = afterWrite.refresh;

  // Save and reset throw the ApiError of a failed request; the field shows
  // it on the shared error path.
  const handleSave = useCallback(
    async (key: string, value: unknown) => {
      await saveTraegerSettingValue(key, value);
      logger.info("traeger_responsibility_saved", { key });
      void refresh();
    },
    [refresh],
  );
  const handleReset = useCallback(
    async (key: string) => {
      await clearTraegerSettingValue(key);
      logger.info("traeger_responsibility_reset", { key });
      void refresh();
    },
    [refresh],
  );

  const tab = schema.data?.tabs.find(
    (candidate) => candidate.key === RESPONSIBILITY_SETTINGS_TAB,
  );
  const rows = schools.data ?? [];
  const own = rows.filter((school) =>
    school.areas.some((area) => area.source === "school"),
  ).length;
  const open = rows.filter((school) =>
    school.areas.some((area) => responsibilityGap(school, area) !== null),
  ).length;

  return (
    <TenantPage
      title="Zuständigkeiten"
      info={INFO}
      stats={
        schools.data ? (
          <TenantPageStats
            items={[
              {
                value: rows.length,
                label: rows.length === 1 ? "Schule" : "Schulen",
              },
              { value: own, label: "mit eigenem Wert" },
              { value: open, label: "mit fehlenden Angaben" },
            ]}
          />
        ) : null
      }
      statsLoading={schools.loading}
      error={schema.loadError ?? schools.error}
      loading={(schema.isLoading && !schema.data) || schools.loading}
    >
      {canEdit ? null : (
        <Alert
          type="info"
          message="Du kannst die Zuständigkeiten nur ansehen. Ändern kann, wer im Träger-Büro die Rolle „Verwaltung“ hat."
        />
      )}
      <LoadErrorAlert error={afterWrite.error} />
      {tab?.categories.map((category) => (
        <SettingsCategory
          key={category.key}
          category={category}
          // Below this card every school stands on its own: here the card
          // names what its values are for.
          title="Für alle Schulen"
          onSave={handleSave}
          onReset={handleReset}
          onSchemaRefresh={() => void refresh()}
          audience="traeger"
          headingLevel={2}
          autosaveNote
        />
      ))}
      {schools.data ? <ResponsibilitySchoolsCard schools={rows} /> : null}
      {schools.data ? <BillingIssuerChecklists schools={rows} /> : null}
    </TenantPage>
  );
}
