import { proxyPost } from "~/lib/route-wrapper.server";

// Serienbriefe (#4813): der Brieftext mit den Angaben eines Kindes, bevor
// er verschickt wird. Das Backend schreibt den Zugriff ins Protokoll.
export const POST = proxyPost(() => "/api/parent-announcements/letter-preview");
