"use client";

import { useMemo } from "react";
import {
  DatabaseForm,
  draftSubmitBlock,
  formValuesFor,
  type DatabaseFormErrorPath,
} from "~/components/database/database-form";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { isSystemRoom, type Room } from "~/lib/room-helpers";
import { useDraftOn } from "~/lib/swr/read-draft";
import { buildRoomFormSections } from "./room-form-sections";

interface RoomStammdatenTabProps {
  readonly room: Room;
  readonly showOccupancy: boolean;
  /** Saves with the version the form rests on; answers the stored room. */
  readonly onSave: (
    data: Partial<Room>,
    version: string | undefined,
  ) => Promise<Room>;
  /** Reads the room again; rejects when the read fails (ADR 0311). */
  readonly reload: () => Promise<Room>;
  /** Shared error path (#2517): catalog text, field errors at the field. */
  readonly errorPath: DatabaseFormErrorPath;
}

/**
 * Der Reiter „Stammdaten" der Raumseite (#3115): das Formular, das vorher im
 * Pane der Datenverwaltung lag. Ein Speichern unten, das Formular setzt sich
 * nach dem Speichern, beim Abbrechen und beim Raumwechsel auf den
 * gespeicherten Stand zurück, damit kein alter Entwurf stehen bleibt. Ein
 * Live-Neuladen des Raums (Belegung) lässt einen Entwurf stehen (ADR 0311).
 */
export function RoomStammdatenTab({
  room,
  showOccupancy,
  onSave,
  reload,
  errorPath,
}: RoomStammdatenTabProps) {
  const sections = useMemo(() => buildRoomFormSections(room), [room]);
  // The form rests on the room's version (ADR 0311): a newer read refills it
  // only while untouched, after a refusal the stored room shows, and nothing
  // is sent until it is read.
  const edit = useDraftOn<
    Room,
    Record<string, unknown>,
    string | undefined,
    Room
  >(
    { opening: room.id, data: room, reload },
    {
      token: (stored) => stored.version,
      toDraft: (stored) => formValuesFor(buildRoomFormSections(stored), stored),
      answer: (saved) => saved,
    },
  );

  const handleSave = async (data: Partial<Room>) => {
    if (!edit.canSubmit) return;
    const result = await edit.submit((version) => onSave(data, version));
    if (result.ok) return;
    // Seit dem Lesen geändert: `reload` zeigt den gespeicherten Raum, ohne
    // Wiederholen derselben Version. Jeder andere Fehler geht an das
    // Formular, das ihn mit Wiederholen zeigt.
    if (!result.refused) throw result.error;
    void errorPath.show(result.error, {
      object: "das Speichern des Raums",
      reload: result.reload,
    });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {showOccupancy ? (
        <SectionCard
          title="Belegung"
          description="Der aktuelle Zustand des Raums, wie ihn die Aufsicht sieht."
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge
              label={room.isOccupied ? "Belegt" : "Frei"}
              tone={room.isOccupied ? "orange" : "green"}
            />
            {room.capacity !== undefined ? (
              <StatusBadge label={`${room.capacity} Plätze`} tone="gray" />
            ) : null}
            {isSystemRoom(room) ? (
              <StatusBadge label="Systemraum" tone="gray" />
            ) : null}
          </div>
          {room.activityName || room.groupName ? (
            <DataGrid>
              {room.activityName ? (
                <DataField label="Aktivität">{room.activityName}</DataField>
              ) : null}
              {room.groupName ? (
                <DataField label="Gruppe">{room.groupName}</DataField>
              ) : null}
            </DataGrid>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Stammdaten">
        <DatabaseForm
          sections={sections}
          draft={
            edit.draft
              ? {
                  values: edit.draft,
                  setValues: edit.setDraft,
                  blocked: draftSubmitBlock(edit),
                }
              : undefined
          }
          initialData={room}
          onSubmit={handleSave}
          onCancel={edit.discard}
          submitLabel="Speichern"
          sectionLevel={3}
          errorPath={errorPath}
          errorObject="das Speichern des Raums"
        />
      </SectionCard>
    </div>
  );
}
