import { describe, expect, it } from "vitest";
import type * as meContract from "./contract/me.generated";
import { mapProfileResponse } from "./profile-helpers";

describe("mapProfileResponse", () => {
  it("should rewrite avatar path starting with /uploads/", () => {
    const backendProfile: meContract.ProfileResponse = {
      id: "200",
      first_name: "Avatar",
      last_name: "Test",
      email: "avatar@example.com",
      avatar: "/uploads/avatars/global/user123.png",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T10:30:00Z",
      version: "v1",
      username: null,
      last_login: null,
    };

    const result = mapProfileResponse(backendProfile);

    expect(result.avatar).toBe("/api/me/profile/avatar/user123.png");
  });

  it("should not rewrite avatar path not starting with /uploads/", () => {
    const backendProfile: meContract.ProfileResponse = {
      id: "300",
      first_name: "External",
      last_name: "Avatar",
      email: "external@example.com",
      avatar: "https://example.com/avatar.jpg",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T10:30:00Z",
      version: "v1",
      username: null,
      last_login: null,
    };

    const result = mapProfileResponse(backendProfile);

    expect(result.avatar).toBe("https://example.com/avatar.jpg");
  });

  it("should handle null avatar", () => {
    const backendProfile: meContract.ProfileResponse = {
      id: "400",
      first_name: "No",
      last_name: "Avatar",
      email: "noavatar@example.com",
      avatar: undefined,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T10:30:00Z",
      version: "v1",
      username: null,
      last_login: null,
    };

    const result = mapProfileResponse(backendProfile);

    expect(result.avatar).toBeUndefined();
  });

  it("should handle avatar path with no filename", () => {
    const backendProfile: meContract.ProfileResponse = {
      id: "500",
      first_name: "Empty",
      last_name: "Path",
      email: "emptypath@example.com",
      avatar: "/uploads/",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T10:30:00Z",
      version: "v1",
      username: null,
      last_login: null,
    };

    const result = mapProfileResponse(backendProfile);

    // When split('/').pop() returns empty string, no rewrite occurs
    expect(result.avatar).toBe("/uploads/");
  });
});
