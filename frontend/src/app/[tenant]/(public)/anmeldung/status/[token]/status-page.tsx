"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { EnrollmentStatusView } from "~/components/enrollment/enrollment-status-view";
import {
  PublicEnrollmentBrand,
  PublicEnrollmentContentSkeleton,
  PublicEnrollmentLocaleSwitcher,
  PublicEnrollmentPageShell,
  PublicEnrollmentSteps,
} from "~/components/enrollment/public-enrollment-shell";
import { useOneTimeQueryFlag } from "~/lib/hooks/use-one-time-query-flag";
import { useAnalyticsSchoolPolicy } from "~/lib/hooks/use-analytics-school-policy";
import { useTenant } from "~/lib/tenant-context";
import type {
  EnrollmentStatusSeedData,
  TokenStatusSeed,
} from "~/lib/token-status-seed";

interface PageProps {
  readonly params: Promise<{ tenant: string; token: string }>;
  readonly initial: Promise<
    TokenStatusSeed<EnrollmentStatusSeedData> | undefined
  >;
}

export default function EnrollmentStatusPage(props: PageProps) {
  // The token may belong to another school; host permission is not enough.
  useAnalyticsSchoolPolicy("", false);
  return (
    <Suspense fallback={null}>
      <EnrollmentStatusPageContent {...props} />
    </Suspense>
  );
}

function EnrollmentStatusPageContent({ params, initial }: PageProps) {
  const { token } = use(params);
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  // One-time: the flag hides the withdraw controls, so it must not survive a
  // refresh or a bookmarked/shared URL (#2156 review).
  const justSubmitted = useOneTimeQueryFlag("submitted");
  const duplicateWarning = searchParams.get("duplicate_warning") === "1";

  return (
    <PublicEnrollmentPageShell withInlineSwitcher>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
        <PublicEnrollmentBrand tenant={tenant} />
        <div className="flex items-center gap-3">
          <PublicEnrollmentSteps current="done" />
          <PublicEnrollmentLocaleSwitcher />
        </div>
      </div>
      <Suspense fallback={<PublicEnrollmentContentSkeleton sections={2} />}>
        <SeededStatusView
          token={token}
          initial={initial}
          justSubmitted={justSubmitted}
          duplicateWarning={duplicateWarning}
        />
      </Suspense>
    </PublicEnrollmentPageShell>
  );
}

function SeededStatusView({
  initial,
  ...props
}: Omit<React.ComponentProps<typeof EnrollmentStatusView>, "initial"> &
  Pick<PageProps, "initial">) {
  const seed = use(initial);
  return <EnrollmentStatusView key={props.token} {...props} initial={seed} />;
}
