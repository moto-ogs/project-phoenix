"use client";

// Die Schulen mit Schichten nach heute, im Dialog vor dem Ausschalten der
// Einsatzplanung (#4708, ADR 0242 Punkt 6). Sie bleiben alle bestehen; die
// Liste zeigt, wo die Schulen noch mit Schichten aus moto arbeiten.

import { useEffect, useState } from "react";

import { FramedList } from "~/components/ui/framed-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { useApiLoadError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  fetchTraegerFutureShifts,
  type TraegerFutureShifts,
} from "~/lib/traeger-planning-api";

const logger = createLogger({ component: "FutureShiftsList" });

export function FutureShiftsList() {
  const [schools, setSchools] = useState<TraegerFutureShifts[] | null>(null);
  const load = useApiLoadError();
  const { show, clear } = load;

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const found = await fetchTraegerFutureShifts();
        if (cancelled) return;
        clear();
        setSchools(found);
      } catch (err) {
        logger.error("traeger_future_shifts_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          await show(err, {
            object: "die Schulen mit geplanten Schichten",
            retry: () => void read(),
          });
        }
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [clear, show]);

  if (load.error) {
    return (
      <div className="mt-4">
        <LoadErrorAlert error={load.error} actionLayout="responsive" />
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
