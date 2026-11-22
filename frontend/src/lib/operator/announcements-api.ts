import { bffJson } from "~/lib/bff-fetch";
import type {
  Announcement,
  AnnouncementStats,
  AnnouncementViewDetail,
  CreateAnnouncementRequest,
  UpdateAnnouncementRequest,
} from "./announcements-helpers";
import { mapAnnouncement, mapViewDetail } from "./announcements-helpers";

class OperatorAnnouncementsService {
  async fetchAll(includeInactive = true): Promise<Announcement[]> {
    const data = await bffJson("platform", "GET /operator/announcements/", {
      query: { include_inactive: includeInactive },
    });
    return data.map(mapAnnouncement);
  }

  async fetchById(id: string): Promise<Announcement> {
    const data = await bffJson("platform", "GET /operator/announcements/{id}", {
      params: { id },
    });
    return mapAnnouncement(data);
  }

  async create(data: CreateAnnouncementRequest): Promise<Announcement> {
    const result = await bffJson("platform", "POST /operator/announcements/", {
      body: data,
    });
    return mapAnnouncement(result);
  }

  async update(
    id: string,
    data: UpdateAnnouncementRequest,
  ): Promise<Announcement> {
    const result = await bffJson(
      "platform",
      "PUT /operator/announcements/{id}",
      { params: { id }, body: data },
    );
    return mapAnnouncement(result);
  }

  async delete(id: string): Promise<void> {
    await bffJson("platform", "DELETE /operator/announcements/{id}", {
      params: { id },
    });
  }

  async publish(id: string): Promise<void> {
    await bffJson("platform", "POST /operator/announcements/{id}/publish", {
      params: { id },
    });
  }

  async fetchStats(id: string): Promise<AnnouncementStats> {
    return bffJson("platform", "GET /operator/announcements/{id}/stats", {
      params: { id },
    });
  }

  async fetchViewDetails(id: string): Promise<AnnouncementViewDetail[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/announcements/{id}/views",
      { params: { id } },
    );
    return data.map(mapViewDetail);
  }
}

export const operatorAnnouncementsService = new OperatorAnnouncementsService();
