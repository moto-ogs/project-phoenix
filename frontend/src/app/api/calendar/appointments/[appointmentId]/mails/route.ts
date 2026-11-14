import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler, isStringParam } from "~/lib/route-wrapper.server";

// Was aus den E-Mails eines Termins an die Eltern wurde (#7058).
export const GET = createGetHandler(async (_request, token: string, params) => {
  const appointmentId = isStringParam(params.appointmentId)
    ? params.appointmentId
    : "";
  const response = await apiGet<{ data: unknown }>(
    `/api/calendar/appointments/${encodeURIComponent(appointmentId)}/mails`,
    token,
  );
  return response.data;
});
