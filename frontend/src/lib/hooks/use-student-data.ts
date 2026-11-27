"use client";

import { useOptionalSupervision } from "~/lib/supervision-context";
import type * as studentsContract from "~/lib/contract/students.generated";
import {
  fetchStudentDetail,
  type StudentDetailResponse,
} from "~/lib/student-detail-resource";
import { studentKeys } from "~/lib/swr/portal-keys";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { hasSessionAccess } from "~/lib/session-access";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import type { Student } from "~/lib/student-helpers";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "StudentData" });

interface StudentDataState {
  student: Student | null;
  loading: boolean;
  /**
   * The failed load as thrown by the client (an `ApiError` with code and
   * request ID), or null. The page shows it over the shared error path
   * (#2513); no sentence is built here.
   */
  error: unknown;
  /**
   * READ access to this child's data — the backend's `has_full_access`, which
   * resolves to `authorize.CanReadStudent`: true for admins and every verified
   * staff member (#2329), false for guest/guardian accounts, whose view stays
   * redacted. Gate read-only surfaces on THIS flag — every backend read path
   * for a child uses the same predicate, so they cannot disagree.
   */
  hasFullAccess: boolean;
  /** WRITE access (`has_write_access`): admins and verified staff (#2329). */
  hasWriteAccess: boolean;
  /** Class-trip authority, independent of Stammdaten writes. */
  hasAbsenceWriteAccess: boolean;
  /** Direct sick/excused reports; does not authorize parent-request review. */
  hasSickExcusedWriteAccess: boolean;
  attendanceLogEnabled: boolean;
  feedbackEnabled: boolean;
  supervisors: studentsContract.SupervisorContact[];
  myGroups: string[];
  myGroupRooms: string[];
  mySupervisedRooms: string[];
}

interface UseStudentDataResult extends StudentDataState {
  /** Settles once the revalidation is through; it never rejects. */
  refreshData: () => Promise<void>;
  /** Reads the child again and rejects when that read fails (ADR 0311). */
  reloadOrThrow: () => Promise<unknown>;
}

/**
 * Custom hook for fetching and managing student detail page data
 * Uses SWR for caching and automatic revalidation via global SSE
 */
export function useStudentData(studentId: string): UseStudentDataResult {
  const { data: session, status: sessionStatus } = useSession();

  const { ownGroupIds, ownGroupRoomNames, ownSessionRoomNames } =
    useOptionalSupervision();

  // SWR-based student data fetching with caching
  // Cache key "student-detail-{id}" will be invalidated by global SSE on student_checkin/checkout events
  const detail = useSWRAuth<StudentDetailResponse>(
    studentId && hasSessionAccess(session)
      ? studentKeys.detail(studentId)
      : null,
    () => fetchStudentDetail(studentId),
    {
      keepPreviousData: false, // Never carry another child's detail or grants.
      revalidateOnFocus: false, // Handled by global SSE
    },
  );
  const { data: studentData, isLoading, error: fetchError, mutate } = detail;
  const detailRef = useRef(detail);
  useLayoutEffect(() => {
    detailRef.current = detail;
  });
  const reloadOrThrow = useCallback(
    () => revalidateOrThrow(detailRef.current),
    [],
  );

  // refreshData now uses SWR's mutate
  const refreshData = useCallback(async () => {
    // A failed reload lands in SWR's error state and from there on the
    // page's load error path; this catch only keeps the promise handled.
    // Awaitable, so useRefreshAfterWrite sees a refusal of the shown child
    // (#6801).
    await mutate().catch((err: unknown) => {
      logger.debug("swr_revalidation_failed", {
        error: err instanceof Error ? err.message : String(err),
        scope: "student_detail",
      });
    });
  }, [mutate]);

  // Convert SWR state to component state
  const error: unknown = fetchError ?? null;

  // Include session loading state to prevent transient error display.
  // When session is loading, SWR key is null, so isLoading is false even though
  // we're not ready to display data. This prevents "Student not found" flash.
  const loading = isLoading || sessionStatus === "loading";

  return {
    student: studentData?.student ?? null,
    loading,
    error,
    hasFullAccess: studentData?.hasFullAccess ?? false,
    hasWriteAccess: studentData?.hasWriteAccess ?? false,
    hasAbsenceWriteAccess: studentData?.hasAbsenceWriteAccess ?? false,
    hasSickExcusedWriteAccess: studentData?.hasSickExcusedWriteAccess ?? false,
    attendanceLogEnabled: studentData?.attendanceLogEnabled ?? false,
    feedbackEnabled: studentData?.feedbackEnabled ?? false,
    supervisors: studentData?.supervisors ?? [],
    myGroups: ownGroupIds,
    myGroupRooms: ownGroupRoomNames,
    mySupervisedRooms: ownSessionRoomNames,
    refreshData,
    reloadOrThrow,
  };
}
