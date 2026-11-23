"use client";

// Abrechnungsvorgaben des Trägers (#5685): was für jede Abrechnung gilt.
// Bankverbindungen (#4653) sieht jede Rolle mit „Übersicht lesen“, ändern darf
// sie, wer „Einstellungen“ hat. Rechnungsnummern der Ferien (#4668) und der
// Monatsbeiträge (#4684), Ermäßigungen (#4664), Kostenträger (#5627) und
// Zahlung und Rechnungen je Leistung (#4689) und die Lastschrift mit
// Gläubiger-ID (#4695) gehören zum Recht „Abrechnung“.

import { useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { BillingTermsCard } from "~/components/traeger/billing-terms-card";
import { ContributionRulesCard } from "~/components/traeger/contribution-rules-card";
import { CostBearersCard } from "~/components/traeger/cost-bearers-card";
import { metadataLoadError } from "~/components/traeger/metadata-load-error";
import { NumberRangeCard } from "~/components/traeger/number-range-card";
import { SepaCreditorCard } from "~/components/traeger/sepa-creditor-card";
import { TraegerBankAccountsCard } from "~/components/traeger/traeger-bank-accounts-card";
import { useTraegerMasterData } from "~/components/traeger/use-traeger-master-data";
import { useTraegerSettingsSchema } from "~/components/traeger/use-traeger-resources";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { TenantPage } from "~/components/ui/tenant-page";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { hasPermission } from "~/lib/auth-utils";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchCareNumberRange,
  fetchHolidayNumberRange,
  type NumberRange,
} from "~/lib/traeger-billing-api";
import {
  type BillingTerms,
  fetchBillingTerms,
} from "~/lib/traeger-billing-terms-api";
import {
  type ContributionRule,
  type CostBearer,
  fetchContributionRules,
  fetchCostBearers,
} from "~/lib/traeger-contributions-api";
import { type SepaCreditor, fetchSepaCreditor } from "~/lib/traeger-sepa-api";

const BILLING_RIGHT = "traeger_billing:manage";

/** The Träger's switch of the SEPA mandate in the parents portal (#4696). */
const ONLINE_MANDATE_KEY = "parent_billing.online_mandate";
const SETTINGS_RIGHT = "traeger_settings:manage";

const INFO = "Hier stehen die Vorgaben für deine Abrechnung.";
const CONTRIBUTION_INFO =
  "So entsteht der Ferienbeitrag: Jede gebuchte Woche kostet den Preis ihres Zeitmodells. Den Preis legst du im Ferienzeitraum fest. Danach gelten die Regeln auf dieser Seite, in dieser Reihenfolge. Beim Bestätigen einer Anmeldung wird der Beitrag festgehalten. Spätere Änderungen gelten nur für neue Bestätigungen.";

interface BillingDefaults {
  readonly rules: ContributionRule[];
  readonly bearers: CostBearer[];
  readonly numberRange: NumberRange;
  readonly careNumberRange: NumberRange;
  readonly terms: BillingTerms;
  readonly creditor: SepaCreditor;
}

const BILLING_OBJECT = "die Übersicht der Abrechnungsvorgaben";

const FRESH = { revalidate: false } as const;

/** The list with `saved` in place of its stored entry. */
function withSaved<T extends { readonly id: string }>(saved: T) {
  return (list: T[] | undefined) =>
    list?.map((entry) => (entry.id === saved.id ? saved : entry));
}

/** Only read with the right „Abrechnung“; without it nothing shows. */
function useBillingDefaults(enabled: boolean) {
  const rules = useTraegerResource(
    enabled ? traegerKeys.contributionRules() : null,
    fetchContributionRules,
    BILLING_OBJECT,
  );
  const bearers = useTraegerResource(
    enabled ? traegerKeys.costBearers() : null,
    fetchCostBearers,
    BILLING_OBJECT,
  );
  const numberRange = useTraegerResource(
    enabled ? traegerKeys.holidayNumberRange() : null,
    fetchHolidayNumberRange,
    BILLING_OBJECT,
  );
  const careNumberRange = useTraegerResource(
    enabled ? traegerKeys.careNumberRange() : null,
    fetchCareNumberRange,
    BILLING_OBJECT,
  );
  const terms = useTraegerResource(
    enabled ? traegerKeys.billingTerms() : null,
    fetchBillingTerms,
    BILLING_OBJECT,
  );
  const creditor = useTraegerResource(
    enabled ? traegerKeys.sepaCreditor() : null,
    fetchSepaCreditor,
    BILLING_OBJECT,
  );
  const readers = [
    rules,
    bearers,
    numberRange,
    careNumberRange,
    terms,
    creditor,
  ];

  const mutateRules = rules.mutate;
  const mutateBearers = bearers.mutate;
  const mutateNumberRange = numberRange.mutate;
  const mutateCareNumberRange = careNumberRange.mutate;
  const mutateTerms = terms.mutate;
  const mutateCreditor = creditor.mutate;
  const latestRead = useRef(0);
  /** Reads every default again after a write; rejects with a failure. */
  const read = useCallback(async () => {
    if (!enabled) return;
    const request = ++latestRead.current;
    // The defaults show together: none changes unless every read succeeded.
    const [rules, bearers, numberRange, careNumberRange, terms, creditor] =
      await Promise.all([
        fetchContributionRules(),
        fetchCostBearers(),
        fetchHolidayNumberRange(),
        fetchCareNumberRange(),
        fetchBillingTerms(),
        fetchSepaCreditor(),
      ]);
    if (request !== latestRead.current) return;
    await Promise.all([
      mutateRules(rules, FRESH),
      mutateBearers(bearers, FRESH),
      mutateNumberRange(numberRange, FRESH),
      mutateCareNumberRange(careNumberRange, FRESH),
      mutateTerms(terms, FRESH),
      mutateCreditor(creditor, FRESH),
    ]);
  }, [
    enabled,
    mutateRules,
    mutateBearers,
    mutateNumberRange,
    mutateCareNumberRange,
    mutateTerms,
    mutateCreditor,
  ]);

  const data: BillingDefaults | null =
    rules.data &&
    bearers.data &&
    numberRange.data &&
    careNumberRange.data &&
    terms.data &&
    creditor.data
      ? {
          rules: rules.data,
          bearers: bearers.data,
          numberRange: numberRange.data,
          careNumberRange: careNumberRange.data,
          terms: terms.data,
          creditor: creditor.data,
        }
      : null;
  return {
    data,
    failure: readers.find((reader) => reader.failure)?.failure,
    error: readers.find((reader) => reader.error)?.error ?? null,
    read,
    /**
     * Read one default again and reject when the read fails, for a save
     * the server refused as changed since it was read (ADR 0311).
     */
    reload: {
      rules: rules.reloadOrThrow,
      bearers: bearers.reloadOrThrow,
      terms: terms.reloadOrThrow,
      creditor: creditor.reloadOrThrow,
    },
    /**
     * Hand a save's answer to its read (ADR 0311, rule 5): `read` changes
     * nothing when one of the six reads fails, and the next change of the
     * same entry would send the version the save replaced.
     */
    write: {
      rule: (saved: ContributionRule) => mutateRules(withSaved(saved), FRESH),
      bearer: (saved: CostBearer) => mutateBearers(withSaved(saved), FRESH),
      terms: (saved: BillingTerms) => mutateTerms(saved, FRESH),
      creditor: (saved: SepaCreditor) => mutateCreditor(saved, FRESH),
    },
  };
}

export default function TraegerAbrechnungsvorgabenPage() {
  const { data: session } = useSession();
  const canBill = hasPermission(session ?? null, BILLING_RIGHT);
  const canEditBank = hasPermission(session ?? null, SETTINGS_RIGHT);
  const invalidateFamily = useInvalidateFamily();
  const master = useTraegerMasterData("die Liste der Bankverbindungen");
  const billing = useBillingDefaults(canBill);
  const settings = useTraegerSettingsSchema();
  const afterBankWrite = useRefreshAfterWrite(
    "die Anzeige der Bankverbindungen",
    async () => {
      void invalidateFamily(traegerKeys.requiredDetails());
      await master.read();
    },
  );
  const afterBillingWrite = useRefreshAfterWrite(
    "die Anzeige der Abrechnungsvorgaben",
    billing.read,
  );
  const afterRequiredDetailsBillingWrite = useCallback(async () => {
    void invalidateFamily(traegerKeys.requiredDetails());
    await afterBillingWrite.refresh();
  }, [afterBillingWrite, invalidateFamily]);
  const onlineMandate = settings.data?.tabs
    .flatMap((tab) => tab.categories)
    .flatMap((category) => category.items)
    .find((item) => item.key === ONLINE_MANDATE_KEY)?.value;
  const error = metadataLoadError(
    master.error ??
      afterBankWrite.error ??
      (canBill
        ? (billing.error ?? afterBillingWrite.error ?? settings.loadError)
        : null) ??
      null,
    master.loaded || (canBill && billing.data !== null),
    master.failure,
    canBill ? billing.failure : undefined,
    canBill ? settings.error : undefined,
  );

  return (
    <TenantPage
      title="Abrechnungsvorgaben"
      info={canBill ? `${INFO} ${CONTRIBUTION_INFO}` : INFO}
      error={error}
      loading={
        !error &&
        (master.loading || !master.loaded || (canBill && !billing.data))
      }
    >
      {master.loaded ? (
        <>
          {canEditBank ? null : (
            <Alert
              type="info"
              message="Die Bankverbindungen kannst du nur ansehen. Ändern kann, wer im Träger-Büro die Rolle „Verwaltung“ hat."
            />
          )}
          {canBill ? null : (
            <Alert
              type="info"
              message="Zahlung, Rechnungsnummern, Ermäßigungen und Kostenträger pflegt die Rolle „Abrechnung“."
            />
          )}
          <TraegerBankAccountsCard
            accounts={master.masterData.bankAccounts}
            canEdit={canEditBank}
            onChanged={afterBankWrite.refresh}
          />
        </>
      ) : null}
      {canBill && billing.data ? (
        <>
          <BillingTermsCard
            data={billing.data.terms}
            onChanged={afterBillingWrite.refresh}
            reload={billing.reload.terms}
            write={billing.write.terms}
          />
          <SepaCreditorCard
            creditor={billing.data.creditor}
            reload={billing.reload.creditor}
            write={billing.write.creditor}
            onlineMandate={
              typeof onlineMandate === "boolean" ? onlineMandate : null
            }
            onChanged={afterRequiredDetailsBillingWrite}
          />
          <NumberRangeCard
            numberRange={billing.data.numberRange}
            onChanged={afterRequiredDetailsBillingWrite}
          />
          <NumberRangeCard
            service="care"
            numberRange={billing.data.careNumberRange}
            onChanged={afterRequiredDetailsBillingWrite}
          />
          <ContributionRulesCard
            kind="sibling"
            rules={billing.data.rules.filter((rule) => rule.kind === "sibling")}
            onChanged={afterBillingWrite.refresh}
            reload={billing.reload.rules}
            write={billing.write.rule}
          />
          <ContributionRulesCard
            kind="benefits_exemption"
            rules={billing.data.rules.filter(
              (rule) => rule.kind === "benefits_exemption",
            )}
            onChanged={afterBillingWrite.refresh}
            reload={billing.reload.rules}
            write={billing.write.rule}
          />
          <CostBearersCard
            bearers={billing.data.bearers}
            onChanged={afterBillingWrite.refresh}
            reload={billing.reload.bearers}
            write={billing.write.bearer}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
