import { EnrollmentEditMessages } from "~/i18n/shared-page-messages";
import { EnrollmentEditPage } from "~/components/enrollment/enrollment-edit-page";

interface PageProps {
  readonly params: Promise<{ tenant: string; token: string }>;
}

// Reduced Halbjahreswechsel flow (#2251): offerings/weekdays only.

export default function PublicEnrollmentAdjustRoute({ params }: PageProps) {
  return (
    <EnrollmentEditMessages>
      <EnrollmentEditPage params={params} adjustOnly />
    </EnrollmentEditMessages>
  );
}
