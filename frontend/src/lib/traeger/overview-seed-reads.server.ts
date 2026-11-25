import { traegerRead } from "./page-seed.server";
import * as requiredDetailsContract from "~/lib/contract/traeger-required-details.generated";
import * as schoolsContract from "~/lib/contract/traeger-schools.generated";
import { readContract } from "~/lib/server-seed.server";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { mapTraegerSchool, mapTraegerSchoolsAlerts } from "~/lib/traeger-api";
import { mapTraegerOccupancy } from "~/lib/traeger-occupancy-api";
import { mapTraegerRequiredDetails } from "~/lib/traeger-required-details-api";

export const schoolsAlerts = traegerRead(
  traegerKeys.schoolsAlerts(),
  "schoolsAlerts",
  async (token, signal) => {
    const { data } = await readContract(
      schoolsContract.routes["GET /traeger/schools/alerts"],
      { token, signal },
    );
    return mapTraegerSchoolsAlerts(data);
  },
);

export function schoolDetail(id: string) {
  return traegerRead(
    traegerKeys.school(id),
    "schoolDetail",
    async (token, signal) => {
      const { data } = await readContract(
        schoolsContract.routes["GET /traeger/schools/{id}"],
        { token, signal, params: { id } },
      );
      return mapTraegerSchool(data);
    },
  );
}

export const occupancy = traegerRead(
  traegerKeys.occupancy(),
  "occupancy",
  async (token, signal) => {
    const { data } = await readContract(
      schoolsContract.routes["GET /traeger/schools/occupancy"],
      { token, signal },
    );
    return mapTraegerOccupancy(data);
  },
);

export const requiredDetails = traegerRead(
  traegerKeys.requiredDetails(),
  "requiredDetails",
  async (token, signal) => {
    const { data } = await readContract(
      requiredDetailsContract.routes["GET /traeger/required-details/"],
      { token, signal },
    );
    return mapTraegerRequiredDetails(data);
  },
);
