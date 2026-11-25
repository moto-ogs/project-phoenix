import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentEnrollPicker } from "~/components/parent/parent-enroll-picker";

const PageMessages = messageBoundary("parentEnroll", "parentNav");

export default function ParentEnrollPickerPage() {
  return (
    <PageMessages>
      <ParentEnrollPicker />
    </PageMessages>
  );
}
