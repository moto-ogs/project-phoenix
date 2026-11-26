"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { openRequestInboxKeys } from "~/lib/request-inbox-open";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

export function AnfragenSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const { data: session } = useSession();
  const withoutReview = session && openRequestInboxKeys(session, "none");
  const withReview = session && openRequestInboxKeys(session, "team");
  return (
    <SWRServerSeed
      seed={seed}
      claims={[
        withoutReview?.accessKey ?? null,
        withoutReview?.mergedKey ?? null,
        withReview?.mergedKey ?? null,
        withoutReview?.withdrawalKey ?? null,
        withoutReview?.waitlistsKey ?? null,
        withoutReview?.staffKey ?? null,
      ]}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
