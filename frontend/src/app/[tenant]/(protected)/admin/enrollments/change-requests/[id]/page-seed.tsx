"use client";

import type { ReactNode } from "react";
import type { AdminEnrollmentChangeRequest } from "~/lib/enrollment-admin-api";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

export function ChangeRequestSeed({
  id,
  seed,
  children,
}: {
  id: string;
  seed: ServerSeedInput;
  children: ReactNode;
}) {
  const key = enrollmentKeys.changeRequest(id);
  return (
    <SWRServerSeed<AdminEnrollmentChangeRequest>
      seed={seed}
      claims={[key]}
      claimsFrom={{
        key,
        derive: (request) =>
          request.id === id && request.request_id
            ? [enrollmentKeys.formLabels(request.request_id)]
            : [],
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
