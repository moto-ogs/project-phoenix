import { bffJson } from "./bff-fetch";
import type {
  PlanningTrack as PlanningTrackResponse,
  planningTrackRequest,
} from "./contract/timetable.generated";

export interface PlanningTrack {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt?: string;
}

function mapTrack(track: PlanningTrackResponse): PlanningTrack {
  return {
    id: track.id,
    name: track.name,
    color: track.color,
    sortOrder: track.sort_order,
    archivedAt: track.archived_at,
  };
}

class PlanningTrackService {
  async list(): Promise<PlanningTrack[]> {
    const tracks = await bffJson(
      "tenant",
      "GET /api/timetable/planning-tracks/",
      {
        errorMessage: "Planungsspuren konnten nicht geladen werden",
      },
    );
    return tracks.map(mapTrack);
  }

  async create(payload: planningTrackRequest): Promise<PlanningTrack> {
    const track = await bffJson(
      "tenant",
      "POST /api/timetable/planning-tracks/",
      {
        body: payload,
        errorMessage: "Planungsspur konnte nicht angelegt werden",
      },
    );
    return mapTrack(track);
  }

  async update(
    id: string,
    payload: planningTrackRequest,
  ): Promise<PlanningTrack> {
    const track = await bffJson(
      "tenant",
      "PUT /api/timetable/planning-tracks/{id}",
      {
        params: { id },
        body: payload,
        errorMessage: "Planungsspur konnte nicht gespeichert werden",
      },
    );
    return mapTrack(track);
  }

  async reorder(ids: string[]): Promise<PlanningTrack[]> {
    const tracks = await bffJson(
      "tenant",
      "PUT /api/timetable/planning-tracks/order",
      {
        body: { ids },
        errorMessage: "Reihenfolge konnte nicht gespeichert werden",
      },
    );
    return tracks.map(mapTrack);
  }

  async archive(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/timetable/planning-tracks/{id}", {
      params: { id },
      errorMessage: "Planungsspur konnte nicht archiviert werden",
    });
  }

  async restore(id: string): Promise<PlanningTrack> {
    const track = await bffJson(
      "tenant",
      "POST /api/timetable/planning-tracks/{id}/restore",
      {
        params: { id },
        errorMessage: "Planungsspur konnte nicht wiederhergestellt werden",
      },
    );
    return mapTrack(track);
  }
}

export const planningTrackService = new PlanningTrackService();
