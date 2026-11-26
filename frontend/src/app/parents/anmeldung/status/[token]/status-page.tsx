"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { EnrollmentStatusView } from "~/components/enrollment/enrollment-status-view";
import {
  PublicEnrollmentContentSkeleton,
  PublicEnrollmentPageShell,
} from "~/components/enrollment/public-enrollment-shell";
import { useOneTimeQueryFlag } from "~/lib/hooks/use-one-time-query-flag";
import { useAnalyticsSchoolPolicy } from "~/lib/hooks/use-analytics-school-policy";
import { parentPath } from "~/lib/parent-url";
import type {
  EnrollmentStatusSeedData,
  TokenStatusSeed,
} from "~/lib/token-status-seed";

interface PageProps {
  readonly params: Promise<{ token: string }>;
  readonly initial: Promise<
    TokenStatusSeed<EnrollmentStatusSeedData> | undefined
  >;
}

export default function ParentEnrollmentStatusPage(props: PageProps) {
  // The token status contract cannot establish the target school's permission.
  useAnalyticsSchoolPolicy("", false);
  return (
    <Suspense
      fallback={
        <PublicEnrollmentPageShell>
          <PublicEnrollmentContentSkeleton sections={2} />
        </PublicEnrollmentPageShell>
      }
    >
      <ParentEnrollmentStatusPageContent {...props} />
    </Suspense>
  );
}

function ParentEnrollmentStatusPageContent({ params, initial }: PageProps) {
  const { token } = use(params);
  const seed = use(initial);
  const searchParams = useSearchParams();
  // One-time: the flag hides the withdraw controls, so it must not survive a
  // refresh or a bookmarked/shared URL (#2156 review).
  const justSubmitted = useOneTimeQueryFlag("submitted");
  return (
    <PublicEnrollmentPageShell>
      <EnrollmentStatusView
        key={token}
        token={token}
        initial={seed}
        justSubmitted={justSubmitted}
        duplicateWarning={searchParams.get("duplicate_warning") === "1"}
        parentAppHref={parentPath("/parents")}
      />
    </PublicEnrollmentPageShell>
  );
}
