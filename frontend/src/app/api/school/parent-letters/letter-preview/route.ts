import { proxyPost } from "~/lib/school/route-wrapper.server";

// Serienbriefe (#4813): die Vorschau für ein Kind einer eigenen Klasse. Das
// Backend lehnt jedes andere Kind ab.
export const POST = proxyPost("/school/parent-letters/letter-preview");
