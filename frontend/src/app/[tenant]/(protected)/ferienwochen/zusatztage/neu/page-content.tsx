"use client";

// Neuer Zusatztag der Schule (#4817, ADR 0329). Er entsteht als Entwurf für
// die eigene OGS; das Veröffentlichen folgt auf seiner eigenen Seite.

import { useMemo } from "react";
import { ExtraDayForm } from "~/components/traeger/extra-day-form";
import { TenantPage } from "~/components/ui/tenant-page";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import { SCHOOL_EXTRA_DAY_STORE } from "~/lib/school-extra-days-api";
import { useInvalidateFamily } from "~/lib/swr";
import { holidayKeys } from "~/lib/swr/portal-keys";
import { useTenant } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { useTenantRouter } from "~/lib/tenant-router";
import { ownSchoolOf } from "../own-school";

const LIST_PATH = "/ferienwochen/zusatztage";

export default function NewSchoolExtraDayPage() {
  const { isReady } = useRequirePermission("schedules:update");
  const router = useTenantRouter();
  const tenantPath = useTenantAwarePath();
  const invalidate = useInvalidateFamily();
  const { tenant } = useTenant();
  const schools = useMemo(() => ownSchoolOf(tenant), [tenant]);

  return (
    <TenantPage
      title="Neuer Zusatztag"
      info="Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Er gilt für deine OGS und wird als Entwurf gespeichert. Eltern melden ihr Kind erst an, wenn du ihn veröffentlicht hast."
      back
      backHref={tenantPath(LIST_PATH)}
      backLabel="Zurück zu den Zusatztagen"
      loading={!isReady || !schools}
    >
      {isReady && schools ? (
        <ExtraDayForm
          ownSchool
          store={SCHOOL_EXTRA_DAY_STORE}
          schools={schools}
          onCancel={() => router.push(LIST_PATH)}
          onSaved={(day) => {
            void invalidate(holidayKeys.extraDaysFamily);
            router.replace(`${LIST_PATH}/${day.id}`);
          }}
        />
      ) : null}
    </TenantPage>
  );
}
