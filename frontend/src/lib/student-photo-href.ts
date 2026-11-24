import { bffFileHref } from "~/lib/bff-fetch";

export function studentPhotoHref(id: string, filename: string): string {
  return bffFileHref("tenant", "GET /api/students/{id}/photo/{filename}", {
    params: { id, filename },
  });
}
