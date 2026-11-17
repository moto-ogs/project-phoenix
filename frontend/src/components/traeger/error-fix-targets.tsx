"use client";

import { useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useCallback, type ReactNode } from "react";

import {
  ErrorFixProvider,
  type ErrorFixTarget,
} from "~/components/ui/error-fix-slot";
import { hasPermission } from "~/lib/auth-utils";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { traegerPath } from "~/lib/traeger-url";
import { EXPORT_RECIPIENT_PATH } from "./export-handover-format";

interface FixTarget {
  /** Träger path; the provider makes it fit the host. */
  readonly path: string;
  readonly label: string;
  readonly tooltip: string;
  /** The Träger right that edits the target; without it no link shows. */
  readonly right: string;
}

/** Settings, letterhead, templates and bank accounts. */
const SETTINGS_RIGHT = "traeger_settings:manage";
/** Number ranges, discounts, SEPA creditor, export recipients. */
const BILLING_RIGHT = "traeger_billing:manage";

const BILLING_DEFAULTS_PATH = "/traeger/einstellungen/abrechnung";
const LETTERHEAD_PATH = "/traeger/einstellungen/briefkopf";

const BILLING_DEFAULTS: Omit<FixTarget, "right"> = {
  path: BILLING_DEFAULTS_PATH,
  label: "Abrechnungsvorgaben öffnen",
  tooltip: "Öffnet die Abrechnungsvorgaben in den Einstellungen.",
};

const LETTERHEAD: FixTarget = {
  path: LETTERHEAD_PATH,
  label: "Briefkopf öffnen",
  tooltip: "Öffnet Briefkopf und Vorlagen in den Einstellungen.",
  right: SETTINGS_RIGHT,
};

/**
 * Where the Träger-Büro fixes a refusal with a known code (#7092). One table
 * for the portal, like `components/tenant/error-fix-targets.tsx` for the
 * school: every `LoadErrorAlert` and `FormErrorAlert` shows the link. The
 * catalog text names the place, so a viewer without the right still knows
 * what to ask for.
 */
const ERROR_FIX_TARGETS: Partial<Record<ErrorCode, FixTarget>> = {
  "parent_billing.datev_not_ready": {
    // As DATEV_SETTINGS_PATH; that module is a whole card for this table.
    path: "/traeger/einstellungen?bereich=datev",
    label: "DATEV-Werte eintragen",
    tooltip: "Öffnet die DATEV-Werte in den Einstellungen.",
    right: SETTINGS_RIGHT,
  },
  "parent_billing.payment_text_debtor_number_missing": {
    path: "/traeger/einstellungen?bereich=ferien",
    label: "Zahlungstext öffnen",
    tooltip: "Öffnet die Einstellungen der Ferienbetreuung beim Zahlungstext.",
    right: SETTINGS_RIGHT,
  },
  "parent_billing.care_amendment_disabled": {
    path: "/traeger/einstellungen?bereich=monatsbeitrag",
    label: "Einstellungen öffnen",
    tooltip: "Öffnet die Einstellungen der Monatsbeiträge.",
    right: SETTINGS_RIGHT,
  },
  "parent_billing.invoice_number_taken": {
    ...BILLING_DEFAULTS,
    right: BILLING_RIGHT,
  },
  "parent_billing.number_range_missing": {
    ...BILLING_DEFAULTS,
    right: BILLING_RIGHT,
  },
  "parent_billing.benefits_exemption_unavailable": {
    ...BILLING_DEFAULTS,
    right: BILLING_RIGHT,
  },
  "parent_billing.sepa_creditor_missing": {
    ...BILLING_DEFAULTS,
    right: BILLING_RIGHT,
  },
  // Bank accounts are master data: the settings right edits them.
  "parent_billing.bank_account_missing": {
    ...BILLING_DEFAULTS,
    right: SETTINGS_RIGHT,
  },
  "parent_billing.sepa_creditor_account_missing": {
    ...BILLING_DEFAULTS,
    right: SETTINGS_RIGHT,
  },
  "parent_billing.legal_remedy_missing": {
    path: `${LETTERHEAD_PATH}/vorlagen/bescheid`,
    label: "Vorlage öffnen",
    tooltip: "Öffnet die Vorlage „Bescheid“ zum Ändern.",
    right: SETTINGS_RIGHT,
  },
  "parent_billing.letterhead_too_long": LETTERHEAD,
  "care_contract.letterhead_too_long": LETTERHEAD,
  "parent_billing.export_recipient_not_ready": {
    path: EXPORT_RECIPIENT_PATH,
    label: "Empfänger prüfen",
    tooltip: "Öffnet die Empfänger der Exporte zum Prüfen.",
    right: BILLING_RIGHT,
  },
};

/** The link to where `code` is fixed, if the viewer holds the right. */
export function traegerFixTarget(
  code: string,
  session: Session | null,
): ErrorFixTarget | null {
  const target = ERROR_FIX_TARGETS[code as ErrorCode];
  if (!target || !hasPermission(session, target.right)) return null;
  return {
    href: traegerPath(target.path),
    label: target.label,
    tooltip: target.tooltip,
  };
}

/** Gives the kit's error alerts the link to where a refusal is fixed. */
export function TraegerErrorFixTargetsProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { data: session } = useSession();
  const resolve = useCallback(
    (code: string) => traegerFixTarget(code, session ?? null),
    [session],
  );
  return <ErrorFixProvider resolve={resolve}>{children}</ErrorFixProvider>;
}
