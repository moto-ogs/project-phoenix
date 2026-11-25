import { messageBoundary } from "~/i18n/scoped-messages";
import { readEnrollmentStatusSeed } from "~/lib/token-status-seed.server";
import EnrollmentStatusPage from "./status-page";

const PageMessages = messageBoundary(
  "enrollmentForm.attachments",
  "enrollmentStatus",
  "language",
  "parentFamilyChildren",
  "enrollmentPublic.fallbackSchool",
  "enrollmentPublic.steps",
);

export default function Page({
  params,
}: Pick<React.ComponentProps<typeof EnrollmentStatusPage>, "params">) {
  const initial = params.then(({ token }) => readEnrollmentStatusSeed(token));
  return (
    <PageMessages>
      <EnrollmentStatusPage params={params} initial={initial} />
    </PageMessages>
  );
}
