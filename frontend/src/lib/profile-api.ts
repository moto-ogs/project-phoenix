import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ProfileAPI" });
import {
  mapProfileResponse,
  mapProfileUpdateRequest,
  type Profile,
  type ProfileUpdateRequest,
} from "./profile-helpers";

/**
 * Fetch the current user's profile
 */
export async function fetchProfile(): Promise<Profile> {
  try {
    return mapProfileResponse(
      await bffJson("tenant", "GET /api/me/profile", {
        errorMessage: "Failed to fetch profile",
      }),
    );
  } catch (error) {
    logger.error("failed to fetch profile", { error: String(error) });
    throw error;
  }
}

/**
 * Update the current user's profile. Throws an ApiError with the backend
 * code and field errors, so the form shows the catalog text (#2517).
 */
export async function updateProfile(
  data: ProfileUpdateRequest,
): Promise<Profile> {
  try {
    const payload = mapProfileUpdateRequest(data);
    return mapProfileResponse(
      await bffJson("tenant", "PUT /api/me/profile", {
        body: payload,
        errorMessage: "Failed to update profile",
      }),
    );
  } catch (error) {
    logger.error("failed to update profile", { error: String(error) });
    throw error;
  }
}

/**
 * Upload a new avatar image. Throws an ApiError (#2517).
 * Note: Uses raw fetch because FormData requires browser-set Content-Type
 */
export async function uploadAvatar(file: File): Promise<Profile> {
  // The session gate, the renewal and the retry are bffJson's (#7806).
  const formData = new FormData();
  formData.append("avatar", file);
  try {
    return mapProfileResponse(
      await bffJson("tenant", "POST /api/me/profile/avatar", {
        body: formData,
        errorMessage: "Failed to upload avatar",
      }),
    );
  } catch (error) {
    logger.error("failed to upload avatar", { error: String(error) });
    throw error;
  }
}
