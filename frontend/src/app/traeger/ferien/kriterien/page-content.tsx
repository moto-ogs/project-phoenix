"use client";

// Kriterien der Platzvergabe des Trägers (#4700). Sie gelten für jeden
// Ferienzeitraum, der seine Plätze nach Kriterien vergibt. moto sortiert die
// Anmeldungen damit nur vor; das Büro entscheidet.

import { HolidayCriteriaEditor } from "~/components/traeger/holiday-criteria-editor";
import { useTraegerHolidayCriteria } from "~/components/traeger/use-traeger-resources";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { revalidateOrThrow } from "~/lib/swr";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerHolidayCriteriaPage() {
  const read = useTraegerHolidayCriteria();
  const { data, loadError, mutate } = read;
  const criteria = data?.criteria;
  const active = criteria?.filter((criterion) => criterion.active).length ?? 0;

  return (
    <TenantPage
      title="Kriterien der Platzvergabe"
      back
      backHref={traegerPath("/traeger/ferien")}
      backLabel="Zurück zu den Ferien"
      info={
        <p>
          Die Kriterien gelten für alle Ferien, die ihre Plätze nach Kriterien
          vergeben. Eltern beantworten jede Frage mit Ja oder Nein. moto
          sortiert die Anmeldungen damit vor. Das ist nur ein Vorschlag. Dein
          Büro entscheidet über jeden Platz. Eltern sehen nie die Angaben
          anderer Familien.
        </p>
      }
      stats={
        criteria ? (
          <TenantPageStats
            items={[
              {
                value: criteria.length,
                label: criteria.length === 1 ? "Kriterium" : "Kriterien",
              },
              { value: active, label: "eingeschaltet" },
            ]}
          />
        ) : null
      }
      statsLoading={!criteria && !loadError}
      error={loadError}
      loading={!loadError && !criteria}
    >
      {data ? (
        <HolidayCriteriaEditor
          source={{
            opening: "criteria",
            data,
            // Reads the criteria again and rejects when that fails.
            reload: () => revalidateOrThrow(read),
            write: (stored) => mutate(stored, { revalidate: false }),
          }}
        />
      ) : null}
    </TenantPage>
  );
}
