"use client";

import { Suspense, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ResetPasswordPageContent } from "~/components/auth/reset-password-page-content";
import { AuthShellSkeleton } from "~/components/auth/auth-shell";
import { buildParentAuthShellCopy } from "~/components/auth/parent-auth-shell-copy";

export default function ParentResetPasswordPage() {
  const t = useTranslations("parentPasswordResetPage");
  const tAuthShell = useTranslations("parentAuthShell");
  const testimonialPanelCopy = useMemo(
    () => buildParentAuthShellCopy(tAuthShell),
    [tAuthShell],
  );

  return (
    <Suspense fallback={<AuthShellSkeleton />}>
      <ResetPasswordPageContent
        portal="parent"
        testimonialPanelCopy={testimonialPanelCopy}
        copy={{
          missingToken: t("errors.missingToken"),
          requestNewLink: t("errors.requestNewLink"),
          newLinkSubtitle: t("errors.newLinkSubtitle"),
          backToLogin: t("backToLogin"),
          errorObject: t("errorObject"),
          passwordTooShort: t("validation.tooShort"),
          passwordMissingUppercase: t("validation.missingUppercase"),
          passwordMissingLowercase: t("validation.missingLowercase"),
          passwordMissingNumber: t("validation.missingNumber"),
          passwordMissingSpecial: t("validation.missingSpecial"),
          passwordMismatch: t("validation.passwordMismatch"),
          successEyebrow: t("success.eyebrow"),
          successTitle: t("success.title"),
          successSubtitle: t("success.subtitle"),
          successBody: t("success.body"),
          formEyebrow: t("form.eyebrow"),
          formTitle: t("form.title"),
          formSubtitle: t("form.subtitle"),
          passwordLabel: t("form.passwordLabel"),
          confirmPasswordLabel: t("form.confirmPasswordLabel"),
          showPassword: t("form.showPassword"),
          hidePassword: t("form.hidePassword"),
          requirementsTitle: t("requirements.title"),
          requirements: [
            t("requirements.minLength"),
            t("requirements.mixedCase"),
            t("requirements.number"),
            t("requirements.special"),
          ],
          submitting: t("form.submitting"),
          submit: t("form.submit"),
        }}
      />
    </Suspense>
  );
}
