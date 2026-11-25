import { traegerRead } from "./page-seed.server";
import * as catalogContract from "~/lib/contract/traeger-catalog.generated";
import * as closingDaysContract from "~/lib/contract/traeger-closing-days.generated";
import * as holidayClosuresContract from "~/lib/contract/traeger-holiday-closures.generated";
import * as holidayContributionsContract from "~/lib/contract/traeger-holiday-contributions.generated";
import * as holidayPeriodsContract from "~/lib/contract/traeger-holiday-periods.generated";
import { readContract } from "~/lib/server-seed.server";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { holidayPeriodFromBackend, mapHolidayPeriods } from "~/lib/traeger-api";
import {
  mapTraegerPhases,
  phaseDetailFromBackend,
} from "~/lib/traeger-catalog-api";
import {
  mapPendingHolidayClosures,
  mapTraegerCalendar,
} from "~/lib/traeger-closing-days";
import { criteriaReadFromBackend } from "~/lib/traeger-holiday-allocation-api";
import { formFromBackend } from "~/lib/traeger-holiday-form-api";
import {
  mapHolidayConfirmationSettings,
  mapHolidayWeekPlaces,
} from "~/lib/traeger-holiday-registrations-api";

export const holidayPeriods = traegerRead(
  traegerKeys.periods(),
  "holidayPeriods",
  async (token, signal) => {
    const { data } = await readContract(
      holidayPeriodsContract.routes["GET /traeger/holiday-periods/"],
      { token, signal },
    );
    return mapHolidayPeriods(data);
  },
);

export function holidayPeriod(id: string) {
  return traegerRead(
    traegerKeys.period(id),
    "holidayPeriod",
    async (token, signal) => {
      const { data } = await readContract(
        holidayPeriodsContract.routes["GET /traeger/holiday-periods/{id}"],
        { token, signal, params: { id } },
      );
      return holidayPeriodFromBackend(data);
    },
  );
}

export const catalogPhases = traegerRead(
  traegerKeys.catalogPhases(),
  "catalogPhases",
  async (token, signal) => {
    const { data } = await readContract(
      catalogContract.routes["GET /traeger/catalog/phases"],
      { token, signal },
    );
    return mapTraegerPhases(data);
  },
);

export function catalogPhase(id: string) {
  return traegerRead(
    traegerKeys.catalogPhase(id),
    "catalogPhase",
    async (token, signal) => {
      const { data } = await readContract(
        catalogContract.routes["GET /traeger/catalog/phases/{id}"],
        { token, signal, params: { id } },
      );
      return phaseDetailFromBackend(data);
    },
  );
}

export const pendingHolidayClosures = traegerRead(
  traegerKeys.holidayClosures(),
  "pendingHolidayClosures",
  async (token, signal) => {
    const { data } = await readContract(
      holidayClosuresContract.routes["GET /traeger/holiday-closures/pending/"],
      { token, signal },
    );
    return mapPendingHolidayClosures(data);
  },
);

export function closingDays(from: string, to: string) {
  return traegerRead(
    traegerKeys.closingDays(from, to),
    "closingDays",
    async (token, signal) => {
      const { data } = await readContract(
        closingDaysContract.routes["GET /traeger/closing-days/"],
        { token, signal, query: { from, to } },
      );
      return mapTraegerCalendar(data);
    },
  );
}

export const holidayCriteria = traegerRead(
  traegerKeys.holidayCriteria(),
  "holidayCriteria",
  async (token, signal) => {
    const { data } = await readContract(
      holidayPeriodsContract.routes["GET /traeger/holiday-periods/criteria"],
      { token, signal },
    );
    return criteriaReadFromBackend(data);
  },
);

export function holidayForm(periodId: string) {
  return traegerRead(
    traegerKeys.holidayForm(periodId),
    "holidayForm",
    async (token, signal) => {
      const { data } = await readContract(
        holidayPeriodsContract.routes["GET /traeger/holiday-periods/{id}/form"],
        { token, signal, params: { id: periodId } },
      );
      return formFromBackend(data);
    },
  );
}

export const holidayConfirmationSettings = traegerRead(
  traegerKeys.holidayConfirmationSettings(),
  "holidayConfirmationSettings",
  async (token, signal) => {
    const { data } = await readContract(
      holidayContributionsContract.routes[
        "GET /traeger/holiday-contributions/confirmation-settings"
      ],
      { token, signal },
    );
    return mapHolidayConfirmationSettings(data);
  },
);

export function holidayPlaces(periodId: string) {
  return traegerRead(
    traegerKeys.holidayPlaces(periodId),
    "holidayPlaces",
    async (token, signal) => {
      const { data } = await readContract(
        holidayPeriodsContract.routes[
          "GET /traeger/holiday-periods/{id}/places"
        ],
        { token, signal, params: { id: periodId } },
      );
      return mapHolidayWeekPlaces(data);
    },
  );
}
