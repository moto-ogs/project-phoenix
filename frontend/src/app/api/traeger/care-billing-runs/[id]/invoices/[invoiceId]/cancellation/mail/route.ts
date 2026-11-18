import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyPost } from "~/lib/traeger/route-wrapper.server";

// Das Storno-Schreiben einer Monatsrechnung senden, zuerst oder erneut
// (#4684). Alte Adresse: der Client ruft seit #2352 über den Katalog-Proxy
// …/invoices/{id}/mail?kind=cancellation. Die Datei bleibt ein Release für
// installierte PWAs mit altem Bundle.
export const POST = proxyPost(
  (params) =>
    `/traeger/care-billing-runs/${requirePathSegmentParam(params)}/invoices/${requirePathSegmentParam(params, "invoiceId")}/mail?kind=cancellation`,
);
