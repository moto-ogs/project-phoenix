import { describe, it, expect } from "vitest";
import type * as operatorAnnouncementsContract from "~/lib/contract/operator-announcements.generated";
import {
  mapAnnouncement,
  mapViewDetail,
  TYPE_LABELS,
  SEVERITY_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  SYSTEM_ROLE_LABELS,
} from "./announcements-helpers";

describe("mapAnnouncement", () => {
  const base: operatorAnnouncementsContract.OperatorAnnouncementResponse = {
    id: "42",
    title: "Release v2.0",
    content: "Neue Features",
    type: "release",
    severity: "warning",
    version: "2.0.0",
    active: true,
    published_at: "2026-03-01T10:00:00Z",
    expires_at: "2026-04-01T10:00:00Z",
    target_roles: ["admin", "user"],
    target_org_ids: ["5", "10"],
    target_tenant_ids: ["12"],
    created_by: "1",
    created_at: "2026-02-28T08:00:00Z",
    updated_at: "2026-02-28T09:00:00Z",
    status: "published",
  };

  it("maps all fields including targeting arrays", () => {
    const result = mapAnnouncement(base);

    expect(result.id).toBe("42");
    expect(result.title).toBe("Release v2.0");
    expect(result.content).toBe("Neue Features");
    expect(result.type).toBe("release");
    expect(result.severity).toBe("warning");
    expect(result.version).toBe("2.0.0");
    expect(result.active).toBe(true);
    expect(result.publishedAt).toBe("2026-03-01T10:00:00Z");
    expect(result.expiresAt).toBe("2026-04-01T10:00:00Z");
    expect(result.targetRoles).toEqual(["admin", "user"]);
    expect(result.targetOrgIds).toEqual(["5", "10"]);
    expect(result.targetTenantIds).toEqual(["12"]);
    expect(result.createdBy).toBe("1");
    expect(result.createdAt).toBe("2026-02-28T08:00:00Z");
    expect(result.updatedAt).toBe("2026-02-28T09:00:00Z");
    expect(result.status).toBe("published");
  });

  it("handles null/undefined optional fields", () => {
    const input: operatorAnnouncementsContract.OperatorAnnouncementResponse = {
      ...base,
      version: undefined,
      published_at: undefined,
      expires_at: undefined,
      target_roles: [],
      target_org_ids: [],
      target_tenant_ids: [],
    };

    const result = mapAnnouncement(input);

    expect(result.version).toBeNull();
    expect(result.publishedAt).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(result.targetRoles).toEqual([]);
    expect(result.targetOrgIds).toEqual([]);
    expect(result.targetTenantIds).toEqual([]);
  });

  it("converts int64 IDs to strings", () => {
    const result = mapAnnouncement(base);

    expect(typeof result.id).toBe("string");
    expect(typeof result.createdBy).toBe("string");
    expect(result.targetOrgIds.every((id) => typeof id === "string")).toBe(
      true,
    );
    expect(result.targetTenantIds.every((id) => typeof id === "string")).toBe(
      true,
    );
  });
});

describe("mapViewDetail", () => {
  it("maps backend view detail to frontend format", () => {
    const input: operatorAnnouncementsContract.AnnouncementViewDetailResponse =
      {
        user_id: "123",
        user_name: "Max Mustermann",
        seen_at: "2026-03-15T14:30:00Z",
        shown_at: "2026-03-15T14:30:00Z",
        dismissed_at: null,
        dismissed: false,
      };

    const result = mapViewDetail(input);

    expect(result.userId).toBe("123");
    expect(result.userName).toBe("Max Mustermann");
    expect(result.seenAt).toBe("2026-03-15T14:30:00Z");
    expect(result.shownAt).toBe("2026-03-15T14:30:00Z");
    expect(result.dismissed).toBe(false);
  });

  it("maps dismissed view detail", () => {
    const input: operatorAnnouncementsContract.AnnouncementViewDetailResponse =
      {
        user_id: "456",
        user_name: "Erika Muster",
        seen_at: "2026-03-15T15:00:00Z",
        shown_at: "2026-03-15T15:00:00Z",
        dismissed_at: "2026-03-15T15:01:00Z",
        dismissed: true,
      };

    const result = mapViewDetail(input);

    expect(result.userId).toBe("456");
    expect(result.dismissed).toBe(true);
  });

  it("preserves a dismissal without a displayed announcement", () => {
    const result = mapViewDetail({
      user_id: "456",
      user_name: "Erika Muster",
      seen_at: "2026-03-15T15:01:00Z",
      shown_at: null,
      dismissed_at: "2026-03-15T15:01:00Z",
      dismissed: true,
    });

    expect(result.seenAt).toBe("2026-03-15T15:01:00Z");
    expect(result.shownAt).toBeNull();
    expect(result.dismissedAt).toBe("2026-03-15T15:01:00Z");
  });
});

describe("label constants", () => {
  it("TYPE_LABELS covers all types", () => {
    expect(TYPE_LABELS.announcement).toBe("Ankündigung");
    expect(TYPE_LABELS.release).toBe("Release");
    expect(TYPE_LABELS.maintenance).toBe("Wartung");
  });

  it("SEVERITY_LABELS covers all severities", () => {
    expect(SEVERITY_LABELS.info).toBe("Info");
    expect(SEVERITY_LABELS.warning).toBe("Warnung");
    expect(SEVERITY_LABELS.critical).toBe("Kritisch");
  });

  it("ANNOUNCEMENT_STATUS_LABELS covers all statuses", () => {
    expect(ANNOUNCEMENT_STATUS_LABELS.draft).toBe("Entwurf");
    expect(ANNOUNCEMENT_STATUS_LABELS.published).toBe("Veröffentlicht");
    expect(ANNOUNCEMENT_STATUS_LABELS.expired).toBe("Abgelaufen");
  });

  it("SYSTEM_ROLE_LABELS covers all roles", () => {
    expect(SYSTEM_ROLE_LABELS.admin).toBe("Verwaltung");
    expect(SYSTEM_ROLE_LABELS.user).toBe("Betreuung");
    expect(SYSTEM_ROLE_LABELS.guardian).toBe("Eltern");
  });
});

describe("mapAnnouncement with values this build does not know (#2353)", () => {
  const announcement: operatorAnnouncementsContract.OperatorAnnouncementResponse =
    {
      id: "7",
      title: "Neu",
      content: "Text",
      type: "newsletter",
      severity: "urgent",
      active: true,
      target_roles: ["admin", "caterer"],
      target_org_ids: null,
      target_tenant_ids: null,
      created_by: "1",
      created_at: "2026-09-01T08:00:00Z",
      updated_at: "2026-09-01T08:00:00Z",
      status: "scheduled",
    };

  it("preserves unknown type and severity values for editing", () => {
    const result = mapAnnouncement(announcement);
    expect(result.type).toBe("newsletter");
    expect(result.severity).toBe("urgent");
  });

  it("leaves an unknown status unknown and keeps every target role", () => {
    const result = mapAnnouncement(announcement);
    expect(result.status).toBeUndefined();
    expect(result.targetRoles).toEqual(["admin", "caterer"]);
  });
});
