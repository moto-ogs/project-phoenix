"use client";

// Hinweis auf der Startseite des Träger-Portals (#7177): welche Pflichtangaben
// dem Träger noch fehlen. Ohne sie verschickt moto keine Verträge und erzeugt
// keine Rechnungen oder Bescheide. Das Backend nennt nur Angaben, deren Modul
// eine Schule des Trägers gebucht hat.

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { hasPermission } from "~/lib/auth-utils";
import { createLogger } from "~/lib/logger";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchTraegerRequiredDetails,
  type TraegerRequiredDetail,
} from "~/lib/traeger-required-details-api";
import { TRAEGER_ROLE_LABELS, type TraegerRole } from "~/lib/traeger-roles";
import { traegerPath } from "~/lib/traeger-url";
import { useTraegerResource } from "./use-traeger-resource";

const logger = createLogger({ component: "TraegerRequiredDetailsNotice" });

const SETTINGS_RIGHT = "traeger_settings:manage";
const BILLING_RIGHT = "traeger_billing:manage";
const LETTERHEAD_PATH = "/traeger/einstellungen/briefkopf";
const BILLING_SETTINGS_PATH = "/traeger/einstellungen/abrechnung";

/** Each detail in the words of its settings page, and who enters it. */
const DETAILS: Readonly<
  Record<
    TraegerRequiredDetail,
    { label: string; right: string; role: TraegerRole; path: string }
  >
> = {
  letterhead: {
    label: "Absender im Briefkopf (Name und Anschrift des Trägers)",
    right: SETTINGS_RIGHT,
    role: "administration",
    path: LETTERHEAD_PATH,
  },
  bank_account: {
    label: "Bankverbindung",
    right: SETTINGS_RIGHT,
    role: "administration",
    path: BILLING_SETTINGS_PATH,
  },
  sepa_creditor: {
    label: "Gläubiger-ID für die Lastschrift",
    right: BILLING_RIGHT,
    role: "billing",
    path: BILLING_SETTINGS_PATH,
  },
  number_range_holiday: {
    label: "Rechnungsnummern der Ferien",
    right: BILLING_RIGHT,
    role: "billing",
    path: BILLING_SETTINGS_PATH,
  },
  number_range_care: {
    label: "Rechnungsnummern der Monatsbeiträge",
    right: BILLING_RIGHT,
    role: "billing",
    path: BILLING_SETTINGS_PATH,
  },
};

/** Where the missing details are entered, one link per page. */
const PAGES = [
  { path: LETTERHEAD_PATH, label: "Briefkopf öffnen" },
  { path: BILLING_SETTINGS_PATH, label: "Abrechnungsvorgaben öffnen" },
] as const;

/**
 * Names the missing details with a link to the page where the viewer enters
 * them. A detail the viewer may not enter names the role that does.
 * Shows nothing while loading, after a failed read or once nothing is
 * missing.
 */
export function TraegerRequiredDetailsNotice() {
  const { data: session } = useSession();
  const { data, failure } = useTraegerResource(
    traegerKeys.requiredDetails(),
    fetchTraegerRequiredDetails,
    "die Pflichtangaben",
  );
  useEffect(() => {
    // The hint only adds to the page; the school list carries the page's
    // own load error. A failed read leaves the hint out and is logged.
    if (!failure) return;
    logger.warn("traeger_required_details_load_failed", {
      error: failure instanceof Error ? failure.message : String(failure),
    });
  }, [failure]);
  if (failure || !data || data.length === 0) return null;
  const can = (detail: TraegerRequiredDetail) =>
    hasPermission(session ?? null, DETAILS[detail].right);
  const links = PAGES.filter((page) =>
    data.some((detail) => DETAILS[detail].path === page.path && can(detail)),
  );
  return (
    <Alert
      type="warning"
      announce="off"
      title="Es fehlen noch Pflichtangaben"
      message="Ohne sie kann moto nicht alle Verträge, Rechnungen und Bescheide erstellen und verschicken."
      details={
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {data.map((detail) => (
            <li key={detail}>
              {DETAILS[detail].label}
              {can(detail)
                ? null
                : ` – trägt die Rolle „${TRAEGER_ROLE_LABELS[DETAILS[detail].role]}“ ein`}
            </li>
          ))}
        </ul>
      }
      action={
        links.length > 0 ? (
          <span className="flex flex-wrap gap-2">
            {links.map((page) => (
              <ButtonLink
                key={page.path}
                href={traegerPath(page.path)}
                variant="surface"
                size="compact"
                tooltip="Öffnet die Seite, auf der Sie die Angaben eintragen."
              >
                {page.label}
              </ButtonLink>
            ))}
          </span>
        ) : undefined
      }
    />
  );
}
