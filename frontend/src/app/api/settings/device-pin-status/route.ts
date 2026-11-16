import { proxyGet } from "~/lib/route-wrapper.server";

export const GET = proxyGet(() => "/api/settings/device-pin-status");
