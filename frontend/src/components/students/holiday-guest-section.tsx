"use client";

import { HolidayHealthFields } from "~/components/holiday/holiday-health-lines";
import { HolidayGuestConsents } from "~/components/holiday/holiday-host-consents";
import { StudentCareTimesSection } from "~/components/students/care-times-section";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { InfoSection } from "~/components/ui/info-section";
import { InfoText } from "~/components/ui/detail-modal-components";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import {
  fetchHolidayGuestSheet,
  formatHolidayHostAnswer,
  holidayGuestLabel,
  type HolidayGuestContact,
} from "~/lib/holiday-host-api";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";

/**
 * Notfallkontakte oder abholberechtigte Personen aus einer Ferienanmeldung,
 * mit anrufbarer Nummer. Der Feriengast und das eigene Kind der OGS (#6678)
 * zeigen sie gleich.
 */
export function HolidayContactList({
  contacts,
  empty,
}: Readonly<{ contacts: HolidayGuestContact[]; empty: string }>) {
  if (contacts.length === 0) return <InfoText>{empty}</InfoText>;
  return (
    <DataGrid columns={1}>
      {contacts.map((contact) => (
        <DataField
          key={`${contact.name}-${contact.phone}`}
          label={
            contact.relationship
              ? `${contact.name} (${contact.relationship})`
              : contact.name
          }
        >
          {contact.phone ? (
            <a
              className="underline"
              href={`tel:${contact.phone.replaceAll(" ", "")}`}
            >
              {contact.phone}
            </a>
          ) : (
            "Keine Telefonnummer angegeben"
          )}
        </DataField>
      ))}
    </DataGrid>
  );
}

/**
 * Foto-Einwilligung eines Feriengasts (#4721). Die Eltern geben und
 * widerrufen sie bei der Heimatschule; die ausrichtende OGS liest bei jedem
 * Abruf den Stand von dort. Die Zeile sagt, was das Team tun darf, und ist
 * reine Anzeige: ändern kann sie hier niemand.
 */
function HolidayGuestPhotoConsent({
  granted,
  schoolName,
}: Readonly<{ granted: boolean; schoolName: string }>) {
  const home = schoolName ? `Heimatschule (${schoolName})` : "Heimatschule";
  return (
    <InfoSection title="Fotos">
      <div className="flex flex-col items-start gap-2">
        <StatusBadge
          label={
            granted ? "Foto-Einwilligung liegt vor" : "Keine Foto-Einwilligung"
          }
          tone={granted ? "green" : "warning"}
        />
        {granted ? null : (
          <InfoText>
            Mach bitte keine Fotos von diesem Kind. In moto liegt keine
            Foto-Einwilligung der Eltern vor.
          </InfoText>
        )}
        <InfoText>{`Die Eltern geben und widerrufen sie an der ${home}. Ein Widerruf gilt sofort auch hier.`}</InfoText>
      </div>
    </InfoSection>
  );
}

/**
 * Stopp von Raumverlauf und Stimmung an der Heimatschule (#8037). Die
 * ausrichtende OGS hält keinen eigenen Stopp: moto liest ihn bei jedem Abruf
 * von dort und speichert für den Gast dann keinen Raumverlauf und keine
 * Stimmung. Die Zeile erscheint nur bei einem Stopp und ist reine Anzeige.
 */
function HolidayGuestRoomHistoryStop({
  schoolName,
}: Readonly<{ schoolName: string }>) {
  const home = schoolName ? `Heimatschule (${schoolName})` : "Heimatschule";
  return (
    <InfoSection title="Raumverlauf und Stimmung">
      <div className="flex flex-col items-start gap-2">
        <StatusBadge label="An der Heimatschule gestoppt" tone="warning" />
        <InfoText>
          moto speichert für dieses Kind keinen Raumverlauf und fragt keine
          Stimmung ab. Du siehst weiter, in welchem Raum das Kind gerade ist.
        </InfoText>
        <InfoText>{`Den Stopp setzt und beendet die ${home}. Er gilt sofort auch hier.`}</InfoText>
      </div>
    </InfoSection>
  );
}

/**
 * Feriengast in der Kindakte (#4666): Für ein Kind, das als Feriengast in die
 * ausrichtende OGS kam, zeigt die Akte nur Betreuung, Notfall und Abholung,
 * dazu die Antworten, die der Träger freigibt (#5202), und die
 * Gesundheitsangaben, wenn die Eltern zugestimmt haben (#4722), und die
 * freiwilligen Einwilligungen der Anmeldung, live gelesen (#8038). Die
 * Angaben stehen auch im Gesundheitsfeld des Kindes. Die Angaben kommen aus
 * der bestätigten Ferienanmeldung beim Träger. Ohne
 * das Recht, Kinderdaten zu lesen, bleibt es beim Hinweis.
 */
export function HolidayGuestSection({
  studentId,
  canRead,
}: Readonly<{ studentId: string; canRead: boolean }>) {
  // Ein Tageswechsel bei offener Seite verschiebt den Vergleich mit (#5994).
  const today = useBerlinToday();
  // Reloads on focus and once a minute: a cancellation, changed contacts or
  // the end of the read-only days reach an open sheet without a reload.
  const sheet = useSWRAuth(
    canRead ? studentKeys.holidayGuest(studentId) : null,
    () => fetchHolidayGuestSheet(studentId),
    { revalidateOnFocus: true, refreshInterval: 60_000 },
  );
  const loadError = useSwrLoadError(
    sheet.error,
    "die Angaben zum Feriengast",
    () => sheet.mutate(),
  );

  const description =
    "Dieses Kind kommt als Feriengast. Hier stehen die Angaben, die der Träger aus der Anmeldung an dich weitergibt.";
  if (!canRead) {
    return (
      <SectionCard title="Feriengast" description={description}>
        <InfoText>
          Notfall, Abholung und Gesundheit sieht, wer die Angaben der Kinder
          lesen darf. Bitte frage deine Leitung.
        </InfoText>
      </SectionCard>
    );
  }
  // A failed reload means the access ended (cancellation, expiry) or cannot
  // be checked: the cached contacts must not stay on the screen.
  const data = sheet.error ? undefined : sheet.data;
  // Soll und Ist der Ferienwoche (#5994): erst ab ihrem ersten Tag, denn
  // vorher ist das Kind noch nicht in der Schule.
  const careTimes =
    data && data.startsOn <= today
      ? { from: data.startsOn, to: data.endsOn < today ? data.endsOn : today }
      : undefined;
  return (
    <>
      <SectionCard title="Feriengast" description={description}>
        {loadError && <LoadErrorAlert error={loadError} />}
        {!data && !loadError && <Skeleton className="h-40 w-full" />}
        {data && (
          <div className="flex flex-col gap-4">
            {data.readOnly && (
              <InfoText>
                Die Ferienwoche ist vorbei. Die Angaben bleiben noch 7 Tage zum
                Nachlesen und werden dann gelöscht.
              </InfoText>
            )}
            <InfoSection title="Betreuung">
              <DataGrid>
                <DataField label="Ferienwoche">
                  {`${formatDate(data.startsOn)} bis ${formatDate(data.endsOn)}`}
                </DataField>
                <DataField label="Zeitmodell">
                  {`${data.timeModelName} (${data.timeModelStartsAt} bis ${data.timeModelEndsAt} Uhr)`}
                </DataField>
                {data.lunch ? (
                  <DataField label="Mittagessen">
                    Ja, an den gebuchten Tagen
                  </DataField>
                ) : null}
                <DataField label="Schule" fullWidth>
                  {holidayGuestLabel(data.schoolName)}
                </DataField>
              </DataGrid>
            </InfoSection>
            <InfoSection title="Notfall">
              <HolidayContactList
                contacts={data.emergencyContacts}
                empty="Kein Notfallkontakt angegeben."
              />
            </InfoSection>
            <InfoSection title="Abholung">
              {data.pickupContacts.length > 0 && (
                <InfoText>Außer den Eltern dürfen abholen:</InfoText>
              )}
              <HolidayContactList
                contacts={data.pickupContacts}
                empty="Nur die Eltern dürfen das Kind abholen."
              />
            </InfoSection>
            {data.health && (
              <InfoSection title="Gesundheit">
                <HolidayHealthFields health={data.health} />
              </InfoSection>
            )}
            {data.homePhotoConsent !== null && (
              <HolidayGuestPhotoConsent
                granted={data.homePhotoConsent}
                schoolName={data.schoolName}
              />
            )}
            {data.homeRoomHistoryStopped === true && (
              <HolidayGuestRoomHistoryStop schoolName={data.schoolName} />
            )}
            <HolidayGuestConsents
              consents={data.consents}
              homePhotoConsent={data.homePhotoConsent}
            />
            {data.answers.length > 0 && (
              <InfoSection title="Angaben aus der Ferienanmeldung">
                <DataGrid>
                  {data.answers.map((answer) => (
                    <DataField key={answer.key} label={answer.label}>
                      {formatHolidayHostAnswer(answer)}
                    </DataField>
                  ))}
                </DataGrid>
              </InfoSection>
            )}
          </div>
        )}
      </SectionCard>
      {careTimes && (
        <StudentCareTimesSection
          key={`${careTimes.from}/${careTimes.to}`}
          studentId={studentId}
          active
          initialRange={careTimes}
          refreshKey={`${data?.timeModelStartsAt}-${data?.timeModelEndsAt}`}
        />
      )}
    </>
  );
}
