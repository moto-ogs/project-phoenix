import { proxyGet } from "~/lib/traeger/route-wrapper.server";

// Heatmap der Ankunfts- und Abholzeiten aller Schulen des Trägers (#4714),
// mit `from` und `to`; nur mit dem Recht „Berichte lesen“.
export const GET = proxyGet("/traeger/schools/arrival-pickup-times");
