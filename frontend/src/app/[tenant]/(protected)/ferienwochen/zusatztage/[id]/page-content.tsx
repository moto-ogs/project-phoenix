"use client";

// Ein Zusatztag der Schule (#4817, ADR 0329): ändern und veröffentlichen.
// Der Link für Eltern steht nach dem Veröffentlichen auf der Seite.

import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ExtraDayForm } from "~/components/traeger/extra-day-form";
import {
  HolidayPeriodStatusBadge,
  holidayPeriodStats,
} from "~/components/traeger/holiday-period-head";
import {
  HolidayPeriodPublishButton,
  HolidayPeriodPublishCard,
} from "~/components/traeger/holiday-period-publish-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  fetchSchoolExtraDay,
  publishSchoolExtraDay,
  SCHOOL_EXTRA_DAY_STORE,
} from "~/lib/school-extra-days-api";
import { revalidateOrThrow, useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { holidayKeys } from "~/lib/swr/portal-keys";
import { useTenant } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { useTenantRouter } from "~/lib/tenant-router";
import type { HolidayPeriod } from "~/lib/traeger-api";
import { ownSchoolOf } from "../own-school";

const LIST_PATH = "/ferienwochen/zusatztage";

export default function SchoolExtraDayPage() {
  const { isReady } = useRequirePermission("schedules:update");
  const router = useTenantRouter();
  const tenantPath = useTenantAwarePath();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { tenant } = useTenant();
  const schools = useMemo(() => ownSchoolOf(tenant), [tenant]);
  const read = useSWRAuth(
    isReady && id ? holidayKeys.extraDay(id) : null,
    () => fetchSchoolExtraDay(id),
    // The Träger-Büro changes the day without an event for the school: a
    // return to the tab reads it again.
    { keepPreviousData: false, revalidateOnFocus: true },
  );
  const loadError = useSwrLoadError(read.error, "den Zusatztag", () =>
    read.mutate(),
  );
  const invalidate = useInvalidateFamily();
  const [dirty, setDirty] = useState(false);
  // A day the school no longer owns answers 404: the page then shows the
  // error alone, not the name and the actions of the day it held before.
  const day = read.error ? undefined : read.data;
  const { mutate } = read;

  const saved = useCallback(
    (next: HolidayPeriod) => {
      void mutate(next, { revalidate: false });
      // The list and the hosted days of „Ferienwochen“ show the day too.
      void invalidate(holidayKeys.extraDays());
      void invalidate(holidayKeys.hostedWeeks());
    },
    [mutate, invalidate],
  );

  return (
    <TenantPage
      title={day?.name ?? "Zusatztag"}
      info="Hier planst du den Zusatztag deiner OGS: den Tag, die Betreuungszeit und den Beitrag. Eltern melden ihr Kind erst an, wenn du ihn veröffentlicht hast. Die Anmeldungen bestätigt dein Träger, dort werden auch die Plätze begrenzt. Bestätigte Kinder stehen unter „Ferienwochen“."
      back
      backHref={tenantPath(LIST_PATH)}
      backLabel="Zurück zu den Zusatztagen"
      stats={day ? <TenantPageStats items={holidayPeriodStats(day)} /> : null}
      statsLoading={!day && !loadError}
      actions={
        day ? (
          <>
            <HolidayPeriodStatusBadge period={day} />
            <HolidayPeriodPublishButton
              period={day}
              unsavedChanges={dirty}
              onPublished={saved}
              publish={publishSchoolExtraDay}
            />
          </>
        ) : null
      }
      error={loadError}
      loading={!loadError && !(day && schools)}
    >
      {day && schools ? (
        <>
          <HolidayPeriodPublishCard
            period={day}
            unsavedChanges={dirty}
            qrBrand="school"
          />
          <ExtraDayForm
            key={day.id}
            ownSchool
            store={SCHOOL_EXTRA_DAY_STORE}
            period={day}
            schools={schools}
            onDirtyChange={setDirty}
            onCancel={() => router.push(LIST_PATH)}
            onSaved={saved}
            reload={() => revalidateOrThrow(read)}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
