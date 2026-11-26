import * as staffExportsContract from "~/lib/contract/traeger-staff-exports.generated";
import { mapPayrollEmployer } from "~/lib/traeger-staff-exports-api";
import { cache } from "react";
import { seedRead } from "~/lib/server-seed.server";
import { organizationNumberRange } from "~/lib/traeger-billing-api";
import { traegerRead } from "./page-seed.server";
import * as billingFamiliesContract from "~/lib/contract/traeger-billing-families.generated";
import * as contractCorrectionsContract from "~/lib/contract/traeger-contract-corrections.generated";
import * as contractImportsContract from "~/lib/contract/traeger-contract-imports.generated";
import * as documentsContract from "~/lib/contract/traeger-documents.generated";
import * as financeExportsContract from "~/lib/contract/traeger-finance-exports.generated";
import * as masterDataContract from "~/lib/contract/traeger-master-data.generated";
import * as numberRangesContract from "~/lib/contract/traeger-number-ranges.generated";
import * as schoolRolesContract from "~/lib/contract/traeger-school-roles.generated";
import * as sepaMandatesContract from "~/lib/contract/traeger-sepa-mandates.generated";
import * as settingsContract from "~/lib/contract/traeger-settings.generated";
import * as staffRecordImportsContract from "~/lib/contract/traeger-staff-record-imports.generated";
import { readContract } from "~/lib/server-seed.server";
import { toSettingsSchema } from "~/lib/settings-api";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import { mapIssuerNumberRanges } from "~/lib/traeger-billing-api";
import { mapDebtorNumberSettings } from "~/lib/traeger-billing-families-api";
import { mapContractImportLog } from "~/lib/traeger-care-contract-import-api";
import { mapContractCorrectionLog } from "~/lib/traeger-contract-correction-api";
import {
  mapDocumentTemplate,
  type DocumentTemplateKind,
} from "~/lib/traeger-document-templates";
import {
  mapTraegerDocumentAudiences,
  mapTraegerDocuments,
} from "~/lib/traeger-documents-api";
import {
  mapExportProtocol,
  datevRunKey,
  datevRunQuery,
  mapDatevRunStates,
  type ExportRun,
  mapExportRuns,
} from "~/lib/traeger-finance-exports-api";
import {
  mapTraegerSchoolRoleCatalog,
  mapTraegerSchoolRoles,
} from "~/lib/traeger-school-roles-api";
import { mapSepaImportLog } from "~/lib/traeger-sepa-import-api";
import { mapStaffImportLog } from "~/lib/traeger-staff-import-api";

export const settingsSchema = traegerRead(
  traegerKeys.settings(),
  "settingsSchema",
  async (token, signal) => {
    const { data } = await readContract(
      settingsContract.routes["GET /traeger/settings/schema"],
      { token, signal },
    );
    return toSettingsSchema(data);
  },
);

const numberRanges = cache((token: string) =>
  seedRead("numberRanges", async (signal) => {
    const { data } = await readContract(
      numberRangesContract.routes["GET /traeger/number-ranges/"],
      { token, signal },
    );
    return data;
  }),
);

export const issuerNumberRanges = {
  key: traegerKeys.issuerNumberRanges(),
  load: async (token: string) => {
    const answer = await numberRanges(token);
    return answer ? mapIssuerNumberRanges(answer) : undefined;
  },
};

export const holidayNumberRange = {
  key: traegerKeys.holidayNumberRange(),
  load: async (token: string) => {
    const answer = await numberRanges(token);
    return answer ? organizationNumberRange(answer, "holiday") : undefined;
  },
};

export const careNumberRange = {
  key: traegerKeys.careNumberRange(),
  load: async (token: string) => {
    const answer = await numberRanges(token);
    return answer ? organizationNumberRange(answer, "care") : undefined;
  },
};

export const debtorNumberSettings = traegerRead(
  traegerKeys.debtorNumberSettings(),
  "debtorNumberSettings",
  async (token, signal) => {
    const { data } = await readContract(
      billingFamiliesContract.routes[
        "GET /traeger/billing-families/debtor-number-format"
      ],
      { token, signal },
    );
    return mapDebtorNumberSettings(data);
  },
);

export const contractImportLog = traegerRead(
  traegerContractKeys.importLog(),
  "contractImportLog",
  async (token, signal) => {
    const { data } = await readContract(
      contractImportsContract.routes["GET /traeger/contract-imports/"],
      { token, signal },
    );
    return mapContractImportLog(data);
  },
);

export const contractCorrectionLog = traegerRead(
  traegerContractKeys.correctionLog(),
  "contractCorrectionLog",
  async (token, signal) => {
    const { data } = await readContract(
      contractCorrectionsContract.routes["GET /traeger/contract-corrections/"],
      { token, signal },
    );
    return mapContractCorrectionLog(data);
  },
);

export function documentTemplate(kind: DocumentTemplateKind) {
  return traegerRead(
    traegerKeys.documentTemplate(kind),
    "documentTemplate",
    async (token, signal) => {
      const { data } = await readContract(
        masterDataContract.routes[
          "GET /traeger/master-data/document-templates/{kind}"
        ],
        { token, signal, params: { kind } },
      );
      return mapDocumentTemplate(data, kind);
    },
  );
}

export const documents = traegerRead(
  traegerKeys.documents(),
  "documents",
  async (token, signal) => {
    const { data } = await readContract(
      documentsContract.routes["GET /traeger/documents/"],
      { token, signal },
    );
    return mapTraegerDocuments(data);
  },
);

export const documentAudiences = traegerRead(
  traegerKeys.documentAudiences(),
  "documentAudiences",
  async (token, signal) => {
    const { data } = await readContract(
      documentsContract.routes["GET /traeger/documents/audiences"],
      { token, signal },
    );
    return mapTraegerDocumentAudiences(data);
  },
);

export function exportRuns(offset = 0) {
  return traegerRead(
    traegerBillingKeys.exportRuns(),
    "exportRuns",
    async (token, signal) => {
      const { data } = await readContract(
        financeExportsContract.routes["GET /traeger/finance-exports/runs"],
        { token, signal, query: { offset: offset > 0 ? offset : undefined } },
      );
      return mapExportRuns(data);
    },
  );
}

export function exportProtocol(offset = 0) {
  return traegerRead(
    traegerBillingKeys.exportProtocol(),
    "exportProtocol",
    async (token, signal) => {
      const { data } = await readContract(
        financeExportsContract.routes["GET /traeger/finance-exports/files"],
        { token, signal, query: { offset: offset > 0 ? offset : undefined } },
      );
      return mapExportProtocol(data);
    },
  );
}

export const schoolRoles = traegerRead(
  traegerKeys.schoolRoles(),
  "schoolRoles",
  async (token, signal) => {
    const [roles, catalog] = await Promise.all([
      readContract(schoolRolesContract.routes["GET /traeger/school-roles/"], {
        token,
        signal,
      }),
      readContract(
        schoolRolesContract.routes["GET /traeger/school-roles/catalog"],
        {
          token,
          signal,
        },
      ),
    ]);
    return {
      list: mapTraegerSchoolRoles(roles.data),
      catalog: mapTraegerSchoolRoleCatalog(catalog.data),
    };
  },
);

export const sepaImportLog = traegerRead(
  traegerBillingRunKeys.sepaImportLog(),
  "sepaImportLog",
  async (token, signal) => {
    const { data } = await readContract(
      sepaMandatesContract.routes["GET /traeger/sepa-mandates/imports"],
      { token, signal },
    );
    return mapSepaImportLog(data);
  },
);

export const staffImportLog = traegerRead(
  traegerStaffKeys.importLog(),
  "staffImportLog",
  async (token, signal) => {
    const { data } = await readContract(
      staffRecordImportsContract.routes["GET /traeger/staff-record-imports/"],
      { token, signal },
    );
    return mapStaffImportLog(data);
  },
);

export const payrollEmployers = traegerRead(
  traegerStaffKeys.payrollEmployers(),
  "payrollEmployers",
  async (token, signal) => {
    const { data } = await readContract(
      staffExportsContract.routes[
        "GET /traeger/staff-exports/payroll/employers"
      ],
      { token, signal },
    );
    return (data.employers ?? []).flatMap(mapPayrollEmployer);
  },
);

// The seed receives only the first run page. Later pages are an interaction.
export function datevFirstPageRuns(runs: readonly ExportRun[]) {
  return {
    ...traegerRead(
      traegerBillingKeys.datevRuns(runs.map(datevRunKey)),
      "datevFirstPageRuns",
      async (token, signal) => {
        if (!runs.length) return mapDatevRunStates([]);
        const query = datevRunQuery(runs);
        if (!query.care.length && !query.holiday.length) {
          return mapDatevRunStates([{ ready: true, runs: [] }]);
        }
        const { data } = await readContract(
          financeExportsContract.routes[
            "GET /traeger/finance-exports/datev-runs"
          ],
          { token, signal, query },
        );
        return mapDatevRunStates([data]);
      },
    ),
    render: false,
  };
}
