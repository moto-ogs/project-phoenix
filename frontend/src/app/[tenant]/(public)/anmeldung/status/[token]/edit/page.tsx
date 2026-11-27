import { EnrollmentEditMessages } from "~/i18n/shared-page-messages";
import { EnrollmentEditPage } from "~/components/enrollment/enrollment-edit-page";

interface PageProps {
  readonly params: Promise<{ tenant: string; token: string }>;
}

export default function PublicEnrollmentEditRoute({ params }: PageProps) {
  return (
    <EnrollmentEditMessages>
      <EnrollmentEditPage params={params} />
    </EnrollmentEditMessages>
  );
}
