// Anhänge einer Elternmitteilung (#2890), Elternseite: die Liste.
//
// Temporary (#2352): the client now reads the list through the catalog proxy
// at /api/parent/parent-news-attachments/{announcementId}. This file serves
// installed apps with an older bundle; delete it after the next production
// deploy, together with its entry in test/proxy-routes/api/parent/me.json.
//
// Der Backend-Pfad liegt nicht unter /parent, weil das dort ein
// Catch-all-Mount ist; er ist wie der Eltern-SSE-Strom an der Wurzel gemountet
// und mit ParentMiddleware geschützt. Wer nicht im Empfängerkreis der
// Mitteilung ist, bekommt 404.

import { proxyGet } from "~/lib/parent/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

export const GET = proxyGet(
  (p) =>
    `/parent-news-attachments/${requirePathSegmentParam(p, "announcementId")}`,
);
