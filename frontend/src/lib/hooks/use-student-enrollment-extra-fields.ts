import { useCallback, useEffect } from "react";

import { useSWRAuth } from "~/lib/swr";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import {
  fetchStudentEnrollmentExtraFields,
  type StudentEnrollmentExtraFieldGroup,
} from "~/lib/student-api";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "useStudentEnrollmentExtraFields" });
const NO_GROUPS: StudentEnrollmentExtraFieldGroup[] = [];

export function useStudentEnrollmentExtraFields(
  studentId: string,
  hasFullAccess: boolean,
) {
  const discard = useDiscardRefusedEntity();
  const key = tenantDailyKeys.studentEnrollmentExtraFields(studentId);
  const { data, error, isLoading, mutate } = useSWRAuth(
    hasFullAccess ? key : null,
    () => fetchStudentEnrollmentExtraFields(studentId),
    {
      keepPreviousData: false,
      onError: (failure) => {
        discard(failure, {
          codes: ["general.permission"],
          refusedKey: key,
          matches: (candidate) => candidate === key,
        });
      },
    },
  );
  // The raw failure for the shared load error path (#2517): the card shows
  // the catalog text with "Wiederholen" instead of silently dropping the
  // Anmeldung answers. A transient failure keeps the shown answers;
  // a refusal drops them from the shared cache.
  // Logged while mounted only: a late failure after leaving the page is
  // nobody's concern.
  useEffect(() => {
    if (error === undefined) return;
    logger.warn("student_enrollment_extra_fields_load_failed", {
      student_id: studentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }, [error, studentId]);
  const reload = useCallback(() => void mutate(), [mutate]);
  const failed = error !== undefined && data === undefined;
  return {
    groups: data ?? NO_GROUPS,
    loading: isLoading,
    hasError: failed,
    error: failed ? (error as unknown) : null,
    reload,
  };
}
