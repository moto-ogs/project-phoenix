"use client";

import { Suspense } from "react";
import { ResetPasswordPageContent } from "~/components/auth/reset-password-page-content";
import { AuthShellSkeleton } from "~/components/auth/auth-shell";

export default function CatererResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ResetPasswordPageContent portal="caterer" />
    </Suspense>
  );
}
