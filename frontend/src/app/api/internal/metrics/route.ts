import { connection, type NextRequest } from "next/server";
import { metricsResponse } from "~/lib/server-metrics.server";
import { withPrivateNoStore } from "~/lib/private-no-store";

async function GETHandler(request: NextRequest) {
  await connection();
  return metricsResponse(request);
}

export const GET = withPrivateNoStore(GETHandler);
