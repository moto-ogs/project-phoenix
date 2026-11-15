"use client";

import { Suspense } from "react";
import { ResetPasswordPageContent } from "~/components/auth/reset-password-page-content";
import { AuthShellSkeleton } from "~/components/auth/auth-shell";
import { schoolPath } from "~/lib/school-url";

export default function SchoolResetPasswordPage() {
  const loginPath = schoolPath("/school/login");

  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ResetPasswordPageContent
        portal="school"
        successRedirectPath={loginPath}
        backHref={loginPath}
        backLabel="Zurück zur Anmeldung"
      />
    </Suspense>
  );
}
