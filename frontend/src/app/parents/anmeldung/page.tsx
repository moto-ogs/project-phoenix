import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentEnrollPicker } from "~/components/parent/parent-enroll-picker";

const PageMessages = messageBoundary("parentEnroll", "parentNav");

export default function ParentEnrollPickerPage() {
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "enrollment" }}>
          <ParentEnrollPicker />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
