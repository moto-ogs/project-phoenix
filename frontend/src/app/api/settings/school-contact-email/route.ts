import { proxyGet } from "~/lib/route-wrapper.server";

// The school's contact address, the default recipient of enrollment
// notifications when the online form is switched on (#7176).
export const GET = proxyGet(() => "/api/settings/school-contact-email");
