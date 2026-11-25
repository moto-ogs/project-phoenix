import { messageBoundary } from "~/i18n/scoped-messages";
import EnrollPhasePickerPage from "./enrollment-start-page";

const PageMessages = messageBoundary("enrollmentPublic", "language");

export default function Page() {
  return (
    <PageMessages>
      <EnrollPhasePickerPage />
    </PageMessages>
  );
}
