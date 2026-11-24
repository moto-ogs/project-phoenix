"use client";

/**
 * Freiwillige Einwilligungen aus der Ferienanmeldung für die ausrichtende OGS
 * (#8038, ADR 0321). moto liest sie bei jedem Abruf live aus der Anmeldung:
 * Ein Widerruf der Eltern steht sofort hier. Reine Anzeige, ändern können
 * sie nur die Eltern (Eltern-App) oder der Träger.
 */

import { InfoText } from "~/components/ui/detail-modal-components";
import { FramedList } from "~/components/ui/framed-list";
import { InfoSection } from "~/components/ui/info-section";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { formatBerlinDate } from "~/lib/date-helpers";
import type { HolidayHostConsent } from "~/lib/holiday-host-api";
import {
  holidayConsentState,
  type HolidayConsentState,
} from "~/lib/holiday-consents";

const STATE_LABELS: Readonly<Record<HolidayConsentState, string>> = {
  given: "Erteilt",
  withdrawn: "Widerrufen",
  notGiven: "Nicht erteilt",
};

/** Kurz für eine Tabellenzelle: Ja, Nein oder Widerrufen. */
const SHORT_LABELS: Readonly<Record<HolidayConsentState, string>> = {
  given: "Ja",
  withdrawn: "Widerrufen",
  notGiven: "Nein",
};

const STATE_TONES: Readonly<Record<HolidayConsentState, StatusBadgeTone>> = {
  given: "green",
  withdrawn: "warning",
  notGiven: "gray",
};

function consentDate(consent: HolidayHostConsent): string {
  if (!consent.changedAt) return "Bei der Anmeldung nicht erteilt.";
  const date = formatBerlinDate(consent.changedAt);
  return consent.given
    ? `Seit ${date}`
    : `Die Eltern haben sie am ${date} widerrufen.`;
}

/** Der Stand einer Einwilligung als kleine Marke in der Teilnehmerliste. */
export function HolidayConsentCell({
  consent,
}: Readonly<{ consent: HolidayHostConsent | undefined }>) {
  if (!consent) return "–";
  const state = holidayConsentState(consent);
  return (
    <StatusBadge
      size="xs"
      label={SHORT_LABELS[state]}
      tone={STATE_TONES[state]}
    />
  );
}

const SORT_RANKS: Readonly<Record<HolidayConsentState, number>> = {
  given: 0,
  withdrawn: 1,
  notGiven: 2,
};

/** Sortierwert einer Einwilligung: Ja vor Widerrufen vor Nein. */
export function holidayConsentSortValue(
  consent: HolidayHostConsent | undefined,
): number | null {
  return consent ? SORT_RANKS[holidayConsentState(consent)] : null;
}

/**
 * Die Einwilligungen eines Feriengasts in der Kindakte. `homePhotoConsent`
 * ist die Foto-Einwilligung der Heimatschule (#4721), `null` ohne Antwort.
 * Steht beides da, nennt der Block die Regel für einen Widerspruch: Bei
 * demselben Thema gilt das Nein, bis die Eltern es geklärt haben. moto
 * deutet keinen Titel des Trägers, die Regel steht deshalb ohne Urteil.
 */
export function HolidayGuestConsents({
  consents,
  homePhotoConsent,
}: Readonly<{
  consents: readonly HolidayHostConsent[];
  homePhotoConsent: boolean | null;
}>) {
  if (consents.length === 0) return null;
  return (
    <InfoSection title="Einwilligungen aus der Ferienanmeldung">
      <div className="flex flex-col gap-3">
        <FramedList>
          {consents.map((consent) => {
            const state = holidayConsentState(consent);
            return (
              <li key={consent.key} className="space-y-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold text-gray-900">
                    {consent.title}
                  </p>
                  <StatusBadge
                    label={STATE_LABELS[state]}
                    tone={STATE_TONES[state]}
                    className="shrink-0"
                  />
                </div>
                <p className="text-sm leading-6 text-gray-700">
                  {consent.label}
                </p>
                <p className="text-sm text-gray-600">{consentDate(consent)}</p>
              </li>
            );
          })}
        </FramedList>
        <InfoText>
          Die Eltern geben und widerrufen diese Einwilligungen in der Eltern-App
          oder beim Träger. Ein Widerruf gilt sofort auch hier.
        </InfoText>
        {homePhotoConsent === null ? null : (
          <InfoText>
            Sagen „Fotos“ oben und eine Einwilligung hier zum selben Thema etwas
            anderes, gilt das Nein, bis die Eltern es geklärt haben.
          </InfoText>
        )}
      </div>
    </InfoSection>
  );
}
