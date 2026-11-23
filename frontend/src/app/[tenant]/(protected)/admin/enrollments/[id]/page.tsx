"use client";

import { use } from "react";
import { AdminEnrollmentDetail } from "~/components/enrollment/admin-enrollment-detail";
import { TenantPage } from "~/components/ui/tenant-page";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";

const ENROLLMENT_DETAIL_INFO =
  "Hier prüfst du eine Anmeldung mit allen Angaben der Familie. Du entscheidest je Kind, zum Beispiel mit „Bestätigen“ oder „Ablehnen“.";

interface PageProps {
  readonly params: Promise<{ tenant: string; id: string }>;
}

export default function AdminEnrollmentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { isReady } = useRequirePermission("config:manage");

  if (!isReady) {
    return (
      <TenantPage
        title="Anmeldung"
        info={ENROLLMENT_DETAIL_INFO}
        back
        backHref="/admin/enrollments"
        backLabel="Zurück zur Anmeldungs-Übersicht"
        statsLoading
        loading
      />
    );
  }

  return <AdminEnrollmentDetail requestId={id} info={ENROLLMENT_DETAIL_INFO} />;
}
