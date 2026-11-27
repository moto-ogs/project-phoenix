import { bffFileHref } from "./bff-fetch";
import type { ProfileResponse } from "./contract/me.generated";

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string | null;
  /** The version of the profile the edit was made from (ADR 0311). */
  version: string;
}

export function mapProfileResponse(data: ProfileResponse): Profile {
  const filename = data.avatar?.startsWith("/uploads/")
    ? data.avatar.split("/").pop()
    : undefined;

  return {
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    avatar: filename
      ? bffFileHref("tenant", "GET /api/me/profile/avatar/{filename}", {
          params: { filename },
        })
      : data.avatar,
    version: data.version,
  };
}
