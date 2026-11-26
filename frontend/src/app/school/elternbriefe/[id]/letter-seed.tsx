"use client";

import type { ReactNode } from "react";
import type { Announcement } from "~/lib/parent-announcements-api";
import {
  schoolLetterDetailKeys,
  schoolLetterDetails,
} from "~/lib/school/letter-seed-keys";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

export function LetterSeed({
  id,
  seed,
  claims,
  children,
}: Readonly<{
  id: string;
  seed: ServerSeedInput;
  claims: readonly string[];
  children: ReactNode;
}>) {
  return (
    <SWRServerSeed
      seed={seed}
      claims={claims}
      claimsFrom={{
        key: schoolPortalKeys.parentLetter(id),
        derive: (letter: Announcement) =>
          schoolLetterDetails(letter).map((part) =>
            schoolLetterDetailKeys[part](id),
          ),
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
