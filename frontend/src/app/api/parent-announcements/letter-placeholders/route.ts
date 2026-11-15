import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";

// Serienbriefe (#4813): die feste Liste der Platzhalter eines Elternbriefs.
export const GET = createGetHandler(async (_request, token: string) => {
  const response = await apiGet<{ data: unknown }>(
    "/api/parent-announcements/letter-placeholders",
    token,
  );
  return response.data;
});
