import { traegerRead } from "./page-seed.server";
import * as billingDocumentKindsContract from "~/lib/contract/traeger-billing-document-kinds.generated";
import * as billingRunsContract from "~/lib/contract/traeger-billing-runs.generated";
import * as billingTermsContract from "~/lib/contract/traeger-billing-terms.generated";
import * as careBillingRunsContract from "~/lib/contract/traeger-care-billing-runs.generated";
import * as careMealTariffsContract from "~/lib/contract/traeger-care-meal-tariffs.generated";
import * as careNoticeRunsContract from "~/lib/contract/traeger-care-notice-runs.generated";
import * as careRulesContract from "~/lib/contract/traeger-care-rules.generated";
import * as careTariffsContract from "~/lib/contract/traeger-care-tariffs.generated";
import * as contributionRulesContract from "~/lib/contract/traeger-contribution-rules.generated";
import * as costBearersContract from "~/lib/contract/traeger-cost-bearers.generated";
import * as exportRecipientContract from "~/lib/contract/traeger-export-recipient.generated";
import * as financeExportsContract from "~/lib/contract/traeger-finance-exports.generated";
import * as requiredDetailsContract from "~/lib/contract/traeger-required-details.generated";
import * as sepaCreditorContract from "~/lib/contract/traeger-sepa-creditor.generated";
import { readContract } from "~/lib/server-seed.server";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { mapBillingPeriods, mapBillingRuns } from "~/lib/traeger-billing-api";
import { mapBillingIssuerStatuses } from "~/lib/traeger-billing-issuers-api";
import { termsFromBackend } from "~/lib/traeger-billing-terms-api";
import {
  mapCareRuns,
  tariffsFromBackend,
} from "~/lib/traeger-care-billing-api";
import { mealTariffsFromBackend } from "~/lib/traeger-care-meal-api";
import { mapCareNoticeRuns } from "~/lib/traeger-care-notices-api";
import { ruleSetFromBackend } from "~/lib/traeger-care-reductions-api";
import {
  mapCostBearers,
  rulesFromBackend,
} from "~/lib/traeger-contributions-api";
import { overviewFromBackend } from "~/lib/traeger-document-kinds-api";
import {
  mapExportRecipient,
  recipientsPageFromBackend,
} from "~/lib/traeger-export-handovers-api";
import {
  bookingAccountsFromBackend,
  settingsFromBackend,
} from "~/lib/traeger-finance-exports-api";
import { creditorFromBackend } from "~/lib/traeger-sepa-api";

export const billingRuns = traegerRead(
  traegerKeys.billingRuns(),
  "billingRuns",
  async (token, signal) => {
    const { data } = await readContract(
      billingRunsContract.routes["GET /traeger/billing-runs/"],
      { token, signal },
    );
    return mapBillingRuns(data);
  },
);

export const billingPeriods = traegerRead(
  traegerBillingKeys.holidayRunPeriods(),
  "billingPeriods",
  async (token, signal) => {
    const { data } = await readContract(
      billingRunsContract.routes["GET /traeger/billing-runs/periods"],
      { token, signal },
    );
    return mapBillingPeriods(data);
  },
);

export const billingIssuers = traegerRead(
  traegerKeys.billingIssuers(),
  "billingIssuers",
  async (token, signal) => {
    const { data } = await readContract(
      requiredDetailsContract.routes["GET /traeger/required-details/issuers"],
      { token, signal },
    );
    return mapBillingIssuerStatuses(data);
  },
);

export const billingTerms = traegerRead(
  traegerKeys.billingTerms(),
  "billingTerms",
  async (token, signal) => {
    const { data } = await readContract(
      billingTermsContract.routes["GET /traeger/billing-terms/"],
      { token, signal },
    );
    return termsFromBackend(data);
  },
);

export const careTariffs = traegerRead(
  traegerBillingKeys.careTariffs(),
  "careTariffs",
  async (token, signal) => {
    const { data } = await readContract(
      careTariffsContract.routes["GET /traeger/care-tariffs/"],
      { token, signal },
    );
    return tariffsFromBackend(data);
  },
);

export const careRuns = traegerRead(
  traegerBillingRunKeys.careRuns(),
  "careRuns",
  async (token, signal) => {
    const { data } = await readContract(
      careBillingRunsContract.routes["GET /traeger/care-billing-runs/"],
      { token, signal },
    );
    return mapCareRuns(data);
  },
);

export const careMealTariffs = traegerRead(
  traegerBillingKeys.careMealTariffs(),
  "careMealTariffs",
  async (token, signal) => {
    const { data } = await readContract(
      careMealTariffsContract.routes["GET /traeger/care-meal-tariffs/"],
      { token, signal },
    );
    return mealTariffsFromBackend(data);
  },
);

export const noticeRuns = traegerRead(
  traegerBillingRunKeys.noticeRuns(),
  "noticeRuns",
  async (token, signal) => {
    const { data } = await readContract(
      careNoticeRunsContract.routes["GET /traeger/care-notice-runs/"],
      { token, signal },
    );
    return mapCareNoticeRuns(data);
  },
);

export const careRules = traegerRead(
  traegerBillingKeys.careRules(),
  "careRules",
  async (token, signal) => {
    const { data } = await readContract(
      careRulesContract.routes["GET /traeger/care-rules/"],
      { token, signal },
    );
    return ruleSetFromBackend(data);
  },
);

export const contributionRules = traegerRead(
  traegerKeys.contributionRules(),
  "contributionRules",
  async (token, signal) => {
    const { data } = await readContract(
      contributionRulesContract.routes["GET /traeger/contribution-rules/"],
      { token, signal },
    );
    return rulesFromBackend(data);
  },
);

export const costBearers = traegerRead(
  traegerKeys.costBearers(),
  "costBearers",
  async (token, signal) => {
    const { data } = await readContract(
      costBearersContract.routes["GET /traeger/cost-bearers/"],
      { token, signal },
    );
    return mapCostBearers(data);
  },
);

export const documentKinds = traegerRead(
  traegerKeys.documentKinds(),
  "documentKinds",
  async (token, signal) => {
    const { data } = await readContract(
      billingDocumentKindsContract.routes[
        "GET /traeger/billing-document-kinds/"
      ],
      { token, signal },
    );
    return overviewFromBackend(data);
  },
);

export const exportRecipients = traegerRead(
  traegerBillingKeys.exportRecipients(),
  "exportRecipients",
  async (token, signal) => {
    const { data } = await readContract(
      exportRecipientContract.routes["GET /traeger/export-recipient/"],
      { token, signal },
    );
    return recipientsPageFromBackend(data);
  },
);

export function exportRecipient(id: string) {
  return traegerRead(
    traegerBillingKeys.exportRecipient(id),
    "exportRecipient",
    async (token, signal) => {
      const { data } = await readContract(
        exportRecipientContract.routes["GET /traeger/export-recipient/{id}"],
        { token, signal, params: { id } },
      );
      return mapExportRecipient(data);
    },
  );
}

export const exportSettings = traegerRead(
  traegerBillingKeys.exportSettings(),
  "exportSettings",
  async (token, signal) => {
    const { data } = await readContract(
      financeExportsContract.routes["GET /traeger/finance-exports/settings"],
      { token, signal },
    );
    return settingsFromBackend(data);
  },
);

export const bookingAccounts = traegerRead(
  traegerBillingKeys.bookingAccounts(),
  "bookingAccounts",
  async (token, signal) => {
    const { data } = await readContract(
      financeExportsContract.routes[
        "GET /traeger/finance-exports/booking-accounts"
      ],
      { token, signal },
    );
    return bookingAccountsFromBackend(data);
  },
);

export const sepaCreditor = traegerRead(
  traegerKeys.sepaCreditor(),
  "sepaCreditor",
  async (token, signal) => {
    const { data } = await readContract(
      sepaCreditorContract.routes["GET /traeger/sepa-creditor/"],
      { token, signal },
    );
    return creditorFromBackend(data);
  },
);
