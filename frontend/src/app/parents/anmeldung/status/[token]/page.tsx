import { messageBoundary } from "~/i18n/scoped-messages";
import { readEnrollmentStatusSeed } from "~/lib/token-status-seed.server";
import ParentEnrollmentStatusPage from "./status-page";

const PageMessages = messageBoundary(
  "enrollmentForm.attachments",
  "enrollmentStatus",
  "language",
  "parentFamilyChildren",
);

export default function Page({
  params,
}: Pick<React.ComponentProps<typeof ParentEnrollmentStatusPage>, "params">) {
  const initial = params.then(({ token }) => readEnrollmentStatusSeed(token));
  return (
    <PageMessages>
      <ParentEnrollmentStatusPage params={params} initial={initial} />
    </PageMessages>
  );
}
