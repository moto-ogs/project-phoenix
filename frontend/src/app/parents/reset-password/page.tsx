import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ResetPasswordPageContent } from "~/components/auth/reset-password-page-content";
import { AuthShellSkeleton } from "~/components/auth/auth-shell";
import { buildParentAuthShellCopy } from "~/components/auth/parent-auth-shell-copy";

export default async function ParentResetPasswordPage() {
  const [t, tAuthShell] = await Promise.all([
    getTranslations("parentPasswordResetPage"),
    getTranslations("parentAuthShell"),
  ]);
  const testimonialPanelCopy = buildParentAuthShellCopy(tAuthShell);

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
