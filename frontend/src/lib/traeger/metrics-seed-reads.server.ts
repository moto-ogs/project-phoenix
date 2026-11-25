import { traegerRead } from "./page-seed.server";
import * as reportTemplatesContract from "~/lib/contract/traeger-report-templates.generated";
import * as reportsContract from "~/lib/contract/traeger-reports.generated";
import * as schoolsContract from "~/lib/contract/traeger-schools.generated";
import { readContract } from "~/lib/server-seed.server";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import {
  mapTraegerArrivalPickupTimes,
  type ArrivalPickupPeriod,
} from "~/lib/traeger-arrival-pickup-api";
import {
  comparisonFromBackend,
  comparisonQuery,
  type ComparisonQuery,
} from "~/lib/traeger-comparison-api";
import {
  mapReportTemplates,
  reportFromBackend,
  reportQuery,
} from "~/lib/traeger-reports-api";
import {
  type UtilizationWindow,
  utilizationFromBackend,
  windowQuery,
} from "~/lib/traeger-utilization-api";

export function arrivalPickupTimes(period: ArrivalPickupPeriod) {
  return traegerRead(
    traegerKeys.arrivalPickupTimes(period.from, period.to),
    "arrivalPickupTimes",
    async (token, signal) => {
      const { data } = await readContract(
        schoolsContract.routes["GET /traeger/schools/arrival-pickup-times"],
        { token, signal, query: { from: period.from, to: period.to } },
      );
      return mapTraegerArrivalPickupTimes(data);
    },
  );
}

export function comparison(query: ComparisonQuery) {
  return traegerRead(
    traegerReportKeys.comparison(query.from, query.to, query.schoolIds),
    "comparison",
    async (token, signal) => {
      const { data } = await readContract(
        schoolsContract.routes["GET /traeger/schools/comparison"],
        { token, signal, query: comparisonQuery(query) },
      );
      return comparisonFromBackend(data);
    },
  );
}

export function keyDateReport(keyDate: string, templateId: string | null) {
  return traegerRead(
    traegerReportKeys.keyDateReport(keyDate, templateId),
    "keyDateReport",
    async (token, signal) => {
      const { data } = await readContract(
        reportsContract.routes["GET /traeger/reports/key-date"],
        { token, signal, query: reportQuery(keyDate, templateId) },
      );
      return reportFromBackend(data);
    },
  );
}

export const reportTemplates = traegerRead(
  traegerKeys.reportTemplates(),
  "reportTemplates",
  async (token, signal) => {
    const { data } = await readContract(
      reportTemplatesContract.routes["GET /traeger/report-templates/"],
      { token, signal },
    );
    return mapReportTemplates(data);
  },
);

export function utilization(window: UtilizationWindow) {
  return traegerRead(
    traegerReportKeys.utilization(window.from, window.to),
    "utilization",
    async (token, signal) => {
      const { data } = await readContract(
        schoolsContract.routes["GET /traeger/schools/utilization"],
        { token, signal, query: windowQuery(window) },
      );
      return utilizationFromBackend(data);
    },
  );
}
