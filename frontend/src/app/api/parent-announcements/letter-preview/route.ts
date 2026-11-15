import { apiPost } from "~/lib/api-helpers.server";
import { createPostHandler } from "~/lib/route-wrapper.server";

// Serienbriefe (#4813): der Brieftext mit den Angaben eines Kindes, bevor
// er verschickt wird. Das Backend schreibt den Zugriff ins Protokoll.
export const POST = createPostHandler(
  async (_request, body: unknown, token: string) => {
    const response = await apiPost<{ data: unknown }>(
      "/api/parent-announcements/letter-preview",
      token,
      body,
    );
    return response.data;
  },
);
