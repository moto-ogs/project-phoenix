import { bffFile } from "~/lib/bff-fetch";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";

export type RoomSnapshotExportFormat = "pdf" | "docx" | "xlsx";

export interface RoomSnapshotExportOptions {
  format: RoomSnapshotExportFormat;
  title: string;
  /**
   * Rooms to include. Omit it to export every room — the backend models this
   * as a pointer and distinguishes an absent key (no filter) from an empty
   * list (matches nothing, so the document comes out empty).
   */
  roomIds?: readonly string[];
  includeTransit: boolean;
}

export async function exportRoomSnapshot(
  options: RoomSnapshotExportOptions,
): Promise<void> {
  const response = await bffFile("tenant", "POST /api/rooms/export", {
    body: {
      format: options.format,
      title: options.title,
      ...(options.roomIds ? { room_ids: [...options.roomIds] } : {}),
      include_transit: options.includeTransit,
    },
    errorMessage: "Room snapshot export failed",
  });

  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `wer-ist-wo.${options.format}`,
  );
}
