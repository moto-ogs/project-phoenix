import { messageBoundary } from "~/i18n/scoped-messages";
import EnrollmentStatusPage from "./status-page";

const PageMessages = messageBoundary(
  "enrollmentForm.attachments",
  "enrollmentStatus",
  "language",
  "parentFamilyChildren",
  "enrollmentPublic.fallbackSchool",
  "enrollmentPublic.steps",
);

export default function Page(
  props: React.ComponentProps<typeof EnrollmentStatusPage>,
) {
  return (
    <PageMessages>
      <EnrollmentStatusPage {...props} />
    </PageMessages>
  );
}
