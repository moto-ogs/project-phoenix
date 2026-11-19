"use client";

import { AnnouncementDetailLoadingPage } from "./page-skeleton";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const ANNOUNCEMENT_DETAIL_INFO =
  "Hier siehst du, was die Eltern bekommen. Unter dem Titel steht, ob es schon veröffentlicht ist. Unter „Zielgruppen und Zustellung“ steht, an wen es geht.";

/**
 * Route-level loading UI: dasselbe Gerüst, das die Seite zeigt, während die
 * Mitteilung lädt, damit der Wechsel ein durchgehendes Skelett ist.
 */
export default function AnnouncementDetailLoading() {
  return <AnnouncementDetailLoadingPage info={ANNOUNCEMENT_DETAIL_INFO} />;
}
