import { headers } from "next/headers";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { isPortalPublicPath } from "~/lib/portal-public-pages";
import { SchoolProviders } from "./providers";
import { SchoolAuthGuard } from "./auth-guard";
import { schoolPageSeed, schoolNotices } from "~/lib/school/page-seed.server";
import { SCHOOL_PUBLIC_PAGES } from "./public-pages";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";

/**
 * Server layout for school routes ("moto schule", #2207).
 * Wraps children in SchoolProviders (SessionProvider with school basePath),
 * then SchoolAuthGuard handles client-side auth checks.
 *
 * German-only like the staff portal — no NextIntlClientProvider here.
 *
 * A valid portal cookie hydrates SessionProvider through a read-only
 * snapshot (#4991), so the guard renders the page without first fetching
 * the session. Never call the portal's auth() here: its refresh callback
 * could rotate the token in a Server Component that cannot persist the
 * new cookie (#1938).
 */
export default async function SchoolLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [snapshot, request] = await Promise.all([
    readPortalSessionSnapshot("school"),
    headers(),
  ]);
  const path = request.get("x-moto-original-path")?.split("?")[0];
  const guarded = (
    <SchoolAuthGuard notBooked={snapshot?.notBooked ?? false}>
      {children}
    </SchoolAuthGuard>
  );
  const shellReads =
    snapshot &&
    !snapshot.notBooked &&
    path &&
    !isPortalPublicPath("school", SCHOOL_PUBLIC_PAGES, path)
      ? schoolPageSeed([schoolNotices])
      : null;

  return (
    <SchoolProviders session={snapshot?.session ?? null}>
      {shellReads ? (
        <SWRServerSeed seed={shellReads.seed} claims={shellReads.claims}>
          {guarded}
        </SWRServerSeed>
      ) : (
        guarded
      )}
    </SchoolProviders>
  );
}
