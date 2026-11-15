"use client";

import { Suspense } from "react";
import { ResetPasswordPageContent } from "~/components/auth/reset-password-page-content";
import { AuthShellSkeleton } from "~/components/auth/auth-shell";

export default function TraegerResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ResetPasswordPageContent portal="traeger" />
    </Suspense>
  );
}
