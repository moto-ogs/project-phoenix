import { EnrollmentEditMessages } from "~/i18n/shared-page-messages";
import { Suspense } from "react";
import { EnrollmentEditPage } from "~/components/enrollment/enrollment-edit-page";
import { PublicEnrollmentContentSkeleton } from "~/components/enrollment/public-enrollment-shell";

interface PageProps {
  readonly params: Promise<{ token: string }>;
}

export default function ParentEnrollmentEditRoute({ params }: PageProps) {
  return (
    <EnrollmentEditMessages>
      <Suspense
        fallback={
          <main className="moto-dotted-background moto-dotted-background--fullscreen min-h-screen px-4 py-5 sm:px-6 sm:py-6">
            <PublicEnrollmentContentSkeleton sections={3} />
          </main>
        }
      >
        <EnrollmentEditPage params={params} />
      </Suspense>
    </EnrollmentEditMessages>
  );
}
