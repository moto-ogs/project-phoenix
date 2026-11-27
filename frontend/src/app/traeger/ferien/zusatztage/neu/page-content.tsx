"use client";

// Neuer Zusatztag des Trägers (#4817). Er entsteht als Entwurf; das
// Veröffentlichen folgt auf seiner eigenen Seite.

import { useRouter } from "next/navigation";
import { ExtraDayForm } from "~/components/traeger/extra-day-form";
import { useHolidayEditorCalendar } from "~/components/traeger/use-week-no-care-days";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { TenantPage } from "~/components/ui/tenant-page";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerPath } from "~/lib/traeger-url";

export default function NewTraegerExtraDayPage() {
  const calendar = useHolidayEditorCalendar();
  const router = useRouter();
  const invalidate = useInvalidateFamily();
  const { schools, error } = useTraegerSchools();
  const listHref = traegerPath("/traeger/ferien/zusatztage");

  return (
    <TenantPage
      title="Neuer Zusatztag"
      info="Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Er wird als Entwurf gespeichert. Eltern melden ihr Kind erst an, wenn du ihn veröffentlicht hast."
      back
      backHref={listHref}
      backLabel="Zurück zu den Zusatztagen"
      error={error}
      loading={!error && !schools}
    >
      {schools ? (
        <ExtraDayForm
          calendar={calendar}
          schools={schools}
          onCancel={() => router.push(listHref)}
          onSaved={(period) => {
            void invalidate(traegerKeys.periodsFamily);
            router.replace(traegerPath(`/traeger/ferien/${period.id}`));
          }}
        />
      ) : null}
    </TenantPage>
  );
}
