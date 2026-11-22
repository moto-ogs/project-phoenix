import type * as meContract from "./contract/me.generated";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ProfileHelpers" });

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username?: string;
  avatar?: string | null;
  bio?: string | null;
  rfidCard?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string | null;
  settings?: ProfileSettings;
}

export interface ProfileSettings {
  theme?: "light" | "dark" | "system";
  language?: string;
  notifications?: NotificationSettings;
  privacy?: PrivacySettings;
}

interface NotificationSettings {
  email?: boolean;
  push?: boolean;
  activities?: boolean;
  roomChanges?: boolean;
}

interface PrivacySettings {
  showEmail?: boolean;
  showProfile?: boolean;
}

export interface ProfileUpdateRequest {
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  avatar?: string;
  settings?: ProfileSettings;
}

// The decoded answer of the catalog proxy (#2353), mapped to the view.
export function mapProfileResponse(data: meContract.ProfileResponse): Profile {
  // Go sends the settings as a JSON string.
  let settings: ProfileSettings | undefined;
  if (data.settings) {
    try {
      settings = JSON.parse(data.settings) as ProfileSettings;
    } catch (error) {
      logger.debug("failed to parse profile settings JSON", {
        error: String(error),
      });
      settings = undefined;
    }
  }

  // Convert avatar path to authenticated API URL
  let avatarUrl = data.avatar;
  if (avatarUrl?.startsWith("/uploads/")) {
    // Extract filename from path
    const filename = avatarUrl.split("/").pop();
    if (filename) {
      // Use authenticated API route that goes through Next.js
      avatarUrl = `/api/me/profile/avatar/${filename}`;
    }
  }

  return {
    id: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    username: data.username ?? undefined,
    avatar: avatarUrl,
    bio: data.bio,
    rfidCard: data.rfid_card,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    lastLogin: data.last_login,
    settings,
  };
}

export function mapProfileUpdateRequest(
  request: ProfileUpdateRequest,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (request.firstName !== undefined) {
    mapped.first_name = request.firstName;
  }
  if (request.lastName !== undefined) {
    mapped.last_name = request.lastName;
  }
  if (request.username !== undefined) {
    mapped.username = request.username;
  }
  if (request.bio !== undefined) {
    mapped.bio = request.bio;
  }
  if (request.avatar !== undefined) {
    mapped.avatar = request.avatar;
  }
  if (request.settings !== undefined) {
    // Convert settings to JSON string if needed
    mapped.settings =
      typeof request.settings === "object"
        ? JSON.stringify(request.settings)
        : request.settings;
  }

  return mapped;
}
