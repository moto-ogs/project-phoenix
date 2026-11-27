"use client";

import { useEffect } from "react";

import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiLoadError } from "~/contexts/ToastContext";
import {
  NOTE_KIND_PERMANENT,
  NOTE_ORIGIN_MASTER_DATA,
  NOTE_VISIBILITY_ALL_STAFF,
  studentNotesService,
  type StudentNote,
} from "~/lib/student-notes-api";
import { NOTE_SHARED_WITH_SCHOOL_BADGE } from "~/components/students/note-badges";
import { useDeviceContext } from "~/lib/device-context";
import { useSWRAuth } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";

// The durable hints of one child on the Stammdaten tab (#3632). They replace
// the former free-text field "Betreuernotizen": same place, same purpose, but
// each hint now carries who wrote it and who may read it.
//
// Read-only on purpose. Writing happens where the chronicle is, so there is
// one place that owns a note and one form that writes it; this card carries no
// button, no chevron and no pointer, per the Missverständnis-Check.

/** Was die Karte ist; am Telefon im „…“-Blatt der Kindakte. */
export const PERMANENT_NOTES_DESCRIPTION =
  "Was für dieses Kind immer gilt. Neue Hinweise schreibst du im Reiter Notizen.";

const VISIBILITY_LABELS: Record<string, string> = {
  care_team: "Betreuungsteam",
  group_leads: "Gruppenleitung",
};

function HintRow({ note }: { readonly note: StudentNote }) {
  const author =
    note.origin === NOTE_ORIGIN_MASTER_DATA
      ? "Übernommen aus den Betreuernotizen"
      : note.authorName;
  return (
    <li className="space-y-1">
      <p className="text-sm whitespace-pre-line text-gray-900">{note.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {author !== "" ? (
          <span className="text-xs text-gray-500">{author}</span>
        ) : null}
        {note.visibility !== NOTE_VISIBILITY_ALL_STAFF ? (
          <StatusBadge
            compact
            tone="blue"
            label={VISIBILITY_LABELS[note.visibility] ?? note.visibility}
            accessibleLabel={`Sichtbar für: ${VISIBILITY_LABELS[note.visibility] ?? note.visibility}`}
          />
        ) : null}
        {note.sharedWithSchool ? (
          <StatusBadge {...NOTE_SHARED_WITH_SCHOOL_BADGE} />
        ) : null}
      </div>
    </li>
  );
}

export function StudentPermanentNotesCard({
  studentId,
}: {
  readonly studentId: string;
}) {
  const device = useDeviceContext();
  const appHead = device.resolved && device.isApp;
  const { data, isLoading, error, mutate } = useSWRAuth<StudentNote[]>(
    studentKeys.permanentNotes(studentId),
    () => studentNotesService.list(studentId, NOTE_KIND_PERMANENT),
  );
  const load = useApiLoadError();
  const showLoadError = load.show;
  const clearLoadError = load.clear;
  useEffect(() => {
    if (error) {
      void showLoadError(error, {
        object: "die Liste der Hinweise",
        retry: () => void mutate(),
      });
    } else {
      clearLoadError();
    }
  }, [error, mutate, showLoadError, clearLoadError]);

  return (
    <SectionCard
      title="Dauerhafte Hinweise"
      // Am Telefon steht der Erklärsatz im „…“-Blatt unter „Über diese
      // Seite“: Im ersten Bild zählen die Hinweise selbst (Runde 19).
      description={appHead ? undefined : PERMANENT_NOTES_DESCRIPTION}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : null}

      {error ? <LoadErrorAlert error={load.error} /> : null}

      {!isLoading && !error ? (
        (data ?? []).length === 0 ? (
          <EmptyState
            variant="compact"
            title="Keine dauerhaften Hinweise"
            description="Im Reiter Notizen kannst du einen anlegen."
          />
        ) : (
          <ul className="space-y-4">
            {(data ?? []).map((note) => (
              <HintRow key={note.id} note={note} />
            ))}
          </ul>
        )
      ) : null}
    </SectionCard>
  );
}
