import { messageBoundary } from "~/i18n/scoped-messages";
import ParentEnrollmentStatusPage from "./status-page";

const PageMessages = messageBoundary(
  "enrollmentForm.attachments",
  "enrollmentStatus",
  "language",
  "parentFamilyChildren",
);

export default function Page(
  props: React.ComponentProps<typeof ParentEnrollmentStatusPage>,
) {
  return (
    <PageMessages>
      <ParentEnrollmentStatusPage {...props} />
    </PageMessages>
  );
}
