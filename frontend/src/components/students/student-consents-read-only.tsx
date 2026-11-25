"use client";

import { useLocale } from "next-intl";
import {
  CollectionGrid,
  CollectionGridTile,
} from "~/components/ui/collection-grid";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatBerlinDate } from "~/lib/date-helpers";
import type { StudentConsent } from "~/lib/student-helpers";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { useDeviceContext } from "~/lib/device-context";

export function StudentConsentsReadOnly({
  consents,
}: Readonly<{ consents?: readonly StudentConsent[] }>) {
  const t = useCareTermTranslations("parentChild.consents");
  const locale = useLocale();
  const device = useDeviceContext();
  const appLayout = device.resolved && device.isApp;
  const visibleConsents =
    consents?.filter((consent) => consent.state !== "not_recorded") ?? [];

  if (visibleConsents.length === 0) return null;

  // App (#8070): eine Liste mit Trennlinien in der Karte statt Kacheln in
  // der Karte.
  if (appLayout) {
    return (
      <SectionCard
        id="student-consents"
        title={t("title")}
        description={t("staffDescription")}
      >
        <ul className="-my-2 divide-y divide-gray-100">
          {visibleConsents.map((consent) => {
            const withdrawn = consent.state === "withdrawn";
            return (
              <li
                key={consent.key}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {t(`items.${consent.key}`)}
                  </p>
                  {consent.changed_at ? (
                    <p className="text-sm text-gray-600">
                      {t(`dates.${withdrawn ? "withdrawn" : "granted"}`, {
                        date: formatBerlinDate(consent.changed_at, locale),
                      })}
                    </p>
                  ) : null}
                </div>
                <StatusBadge
                  label={t(`states.${withdrawn ? "withdrawn" : "granted"}`)}
                  tone={withdrawn ? "red" : "green"}
                />
              </li>
            );
          })}
        </ul>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="student-consents"
      title={t("title")}
      description={t("staffDescription")}
    >
      {/* Raster statt Zeilen (#4365): drei bis sechs kurze Einträge füllen
          die Breite, der Status steht direkt neben seinem Titel. */}
      <CollectionGrid as="ul">
        {visibleConsents.map((consent) => {
          const withdrawn = consent.state === "withdrawn";
          return (
            <CollectionGridTile
              key={consent.key}
              className="flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {t(`items.${consent.key}`)}
                </p>
                {consent.changed_at ? (
                  <p className="mt-1 text-sm text-gray-600">
                    {t(`dates.${withdrawn ? "withdrawn" : "granted"}`, {
                      date: formatBerlinDate(consent.changed_at, locale),
                    })}
                  </p>
                ) : null}
              </div>
              <StatusBadge
                label={t(`states.${withdrawn ? "withdrawn" : "granted"}`)}
                tone={withdrawn ? "red" : "green"}
              />
            </CollectionGridTile>
          );
        })}
      </CollectionGrid>
    </SectionCard>
  );
}
