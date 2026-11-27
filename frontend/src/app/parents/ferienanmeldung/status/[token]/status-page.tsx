"use client";

import { Suspense, use } from "react";
import { PublicEnrollmentPageShell } from "~/components/enrollment/public-enrollment-shell";
import {
  HolidayRegistrationStatusLoading,
  HolidayRegistrationStatusView,
} from "~/components/holiday-registration/holiday-registration-status-view";
import type { HolidayRegistrationStatus } from "~/lib/holiday-registration-status-api";
import { useAnalyticsSchoolPolicy } from "~/lib/hooks/use-analytics-school-policy";
import type { TokenStatusSeed } from "~/lib/token-status-seed";

interface Props {
  readonly params: Promise<{ token: string }>;
  readonly initial: Promise<
    TokenStatusSeed<HolidayRegistrationStatus> | undefined
  >;
}

export default function HolidayRegistrationStatusPage(props: Props) {
  // A token status page establishes no school policy: it collects nothing.
  useAnalyticsSchoolPolicy("", false);
  return (
    <PublicEnrollmentPageShell>
      <Suspense fallback={<HolidayRegistrationStatusLoading />}>
        <StatusContent {...props} />
      </Suspense>
    </PublicEnrollmentPageShell>
  );
}

function StatusContent({ params, initial }: Props) {
  const { token } = use(params);
  const seed = use(initial);
  return (
    <HolidayRegistrationStatusView key={token} token={token} initial={seed} />
  );
}
