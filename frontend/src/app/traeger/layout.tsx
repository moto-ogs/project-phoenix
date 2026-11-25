import { headers } from "next/headers";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { isPortalPublicPath } from "~/lib/portal-public-pages";
import { TraegerProviders } from "./providers";
import { TraegerAuthGuard } from "./auth-guard";
import {
  organization,
  profile,
  traegerPageSeed,
} from "~/lib/traeger/page-seed.server";
import { TRAEGER_PUBLIC_PAGES } from "./public-pages";
import {
  readPortalSessionSnapshot,
  readRenderedSessionMark,
} from "~/lib/portal-session-snapshot.server";

/**
 * Server layout for Träger routes ("moto träger", #4649). German-only like
 * the staff portals — no NextIntlClientProvider here.
 *
 * A valid portal cookie hydrates SessionProvider through a read-only
 * snapshot (#4991), so the guard renders the page without first fetching
 * the session. Never call the portal's auth() here: its refresh callback
 * could rotate the token in a Server Component that cannot persist the
 * new cookie (#1938).
 */
export default async function TraegerLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [snapshot, request] = await Promise.all([
    readPortalSessionSnapshot("traeger"),
    headers(),
  ]);
  const path = request.get("x-moto-original-path")?.split("?")[0];
  const guarded = <TraegerAuthGuard>{children}</TraegerAuthGuard>;
  const shellReads =
    snapshot &&
    !snapshot.notBooked &&
    path &&
    !isPortalPublicPath("traeger", TRAEGER_PUBLIC_PAGES, path)
      ? traegerPageSeed([organization, profile])
      : null;

  return (
    <TraegerProviders
      session={snapshot?.session ?? null}
      sessionMark={await readRenderedSessionMark("traeger")}
    >
      {shellReads ? (
        <SWRServerSeed seed={shellReads.seed} claims={shellReads.claims}>
          {guarded}
        </SWRServerSeed>
      ) : (
        guarded
      )}
    </TraegerProviders>
  );
}
