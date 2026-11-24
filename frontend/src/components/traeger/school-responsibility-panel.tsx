"use client";

import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { SchoolResponsibilityTab } from "./school-responsibility-tab";
import { useTraegerResponsibilities } from "./use-traeger-responsibilities";

/**
 * Who is responsible at one school (#4811), read when the tab opens: the
 * read shows bank accounts and stands in the Träger's log. The school page
 * loads this panel on demand.
 */
export function SchoolResponsibilityPanel({
  schoolId,
}: Readonly<{ schoolId: string }>) {
  const { data, loading, error, reloadOrThrow } = useTraegerResponsibilities();
  const school = data?.find((entry) => entry.schoolId === schoolId);
  if (error) return <LoadErrorAlert error={error} />;
  if (loading || !data) return <Loading />;
  if (!school) {
    return (
      <EmptyState
        variant="compact"
        title="Für diese Schule gibt es keine Zuständigkeiten"
        description="Die Schule gehört nicht mehr zu deinem Träger."
      />
    );
  }
  return <SchoolResponsibilityTab school={school} reload={reloadOrThrow} />;
}
