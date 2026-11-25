"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { InvitationPageContent } from "~/components/auth/invitation-page-content";
import { Loading } from "~/components/ui/loading";
import type { PortalKey } from "~/lib/portal-paths";

function InviteWithToken({
  redirectToPath,
  portal,
}: {
  redirectToPath?: string;
  portal: PortalKey;
}) {
  const searchParams = useSearchParams();
  return (
    <InvitationPageContent
      token={searchParams.get("token")}
      redirectToPath={redirectToPath}
      portal={portal}
    />
  );
}

export function InvitationPageRoute({
  redirectToPath,
  portal,
}: {
  /** Post-accept redirect override — see InvitationAcceptForm (#2207). */
  redirectToPath?: string;
  /** The portal of the page, whose session the accept form ends. */
  portal: PortalKey;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <InviteWithToken redirectToPath={redirectToPath} portal={portal} />
    </Suspense>
  );
}
