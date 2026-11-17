"use client";

// Die Schulen mit Schichten nach heute, im Dialog vor dem Ausschalten der
// Einsatzplanung (#4708, ADR 0242 Punkt 6). Sie bleiben alle bestehen; die
// Liste zeigt, wo die Schulen noch mit Schichten aus moto arbeiten.

import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { FramedList } from "~/components/ui/framed-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import { fetchTraegerFutureShifts } from "~/lib/traeger-planning-api";

export function FutureShiftsList() {
  const { data: schools, error } = useTraegerResource(
    traegerStaffKeys.futureShifts(),
    fetchTraegerFutureShifts,
    "die Schulen mit geplanten Schichten",
  );

  if (error) {
    return (
      <div className="mt-4">
        <LoadErrorAlert error={error} actionLayout="responsive" />
      </div>
    );
  }
  if (!schools) return <Loading />;
  if (schools.length === 0) {
    return (
      <p className="mt-4 text-sm text-gray-600">
        Keine Schule hat Schichten nach heute.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-medium text-gray-900">
        Diese Schulen haben Schichten nach heute:
      </p>
      <FramedList>
        {schools.map((school) => (
          <li
            key={school.schoolId}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <span className="min-w-0 truncate text-gray-900">
              {school.schoolName}
            </span>
            <span className="shrink-0 text-gray-600 tabular-nums">
              {school.shifts === 1 ? "1 Schicht" : `${school.shifts} Schichten`}
            </span>
          </li>
        ))}
      </FramedList>
    </div>
  );
}
