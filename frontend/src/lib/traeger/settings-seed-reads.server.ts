import { traegerRead } from "./page-seed.server";
import * as absenceTypesContract from "~/lib/contract/traeger-absence-types.generated";
import * as contractTemplatesContract from "~/lib/contract/traeger-contract-templates.generated";
import * as contractsContract from "~/lib/contract/traeger-contracts.generated";
import * as masterDataContract from "~/lib/contract/traeger-master-data.generated";
import * as staffProofsContract from "~/lib/contract/traeger-staff-proofs.generated";
import { readContract } from "~/lib/server-seed.server";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import { mapTraegerAbsenceTypes } from "~/lib/traeger-absence-api";
import { mapTraegerMasterData } from "~/lib/traeger-api";
import {
  mapConclusionModes,
  mapContractTemplates,
} from "~/lib/traeger-care-contracts-api";
import { mapDocumentTemplates } from "~/lib/traeger-document-templates";
import { mapResponsibilities } from "~/lib/traeger-responsibilities-api";
import { mapSchoolKinds } from "~/lib/traeger-staff-proofs-api";

export const absenceTypes = traegerRead(
  traegerStaffKeys.absenceTypes(),
  "absenceTypes",
  async (token, signal) => {
    const { data } = await readContract(
      absenceTypesContract.routes["GET /traeger/absence-types/"],
      { token, signal },
    );
    return mapTraegerAbsenceTypes(data);
  },
);

export const masterData = traegerRead(
  traegerKeys.masterData(),
  "masterData",
  async (token, signal) => {
    const { data } = await readContract(
      masterDataContract.routes["GET /traeger/master-data/"],
      { token, signal },
    );
    return mapTraegerMasterData(data);
  },
);

export const conclusionModes = traegerRead(
  traegerContractKeys.conclusionModes(),
  "conclusionModes",
  async (token, signal) => {
    const { data } = await readContract(
      contractsContract.routes["GET /traeger/contracts/conclusion-modes"],
      { token, signal },
    );
    return mapConclusionModes(data);
  },
);

export const contractTemplates = traegerRead(
  traegerContractKeys.templates(),
  "contractTemplates",
  async (token, signal) => {
    const { data } = await readContract(
      contractTemplatesContract.routes["GET /traeger/contract-templates/"],
      { token, signal },
    );
    return mapContractTemplates(data);
  },
);

export const documentTemplates = traegerRead(
  traegerKeys.documentTemplates(),
  "documentTemplates",
  async (token, signal) => {
    const { data } = await readContract(
      masterDataContract.routes["GET /traeger/master-data/document-templates"],
      { token, signal },
    );
    return mapDocumentTemplates(data);
  },
);

export const responsibilities = traegerRead(
  traegerKeys.responsibilities(),
  "responsibilities",
  async (token, signal) => {
    const { data } = await readContract(
      masterDataContract.routes["GET /traeger/master-data/responsibilities"],
      { token, signal },
    );
    return mapResponsibilities(data);
  },
);

export const schoolProofKinds = traegerRead(
  traegerReportKeys.schoolProofKinds(),
  "schoolProofKinds",
  async (token, signal) => {
    const { data } = await readContract(
      staffProofsContract.routes["GET /traeger/staff-proofs/school-kinds"],
      { token, signal },
    );
    return mapSchoolKinds(data);
  },
);
