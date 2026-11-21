import { knownEnum } from "~/lib/contract/known-enum";
import { labelOf } from "~/lib/label-of";
import type {
  AnnouncementViewDetailResponse as WireAnnouncementViewDetail,
  CreateAnnouncementRequest as WireCreateAnnouncementRequest,
  OperatorAnnouncementResponse as WireAnnouncement,
  UpdateAnnouncementRequest as WireUpdateAnnouncementRequest,
} from "~/lib/contract/operator-announcements.generated";
import { SYSTEM_ROLE_LABELS as ROLE_LABELS } from "~/lib/role-labels";

export type { AnnouncementStats } from "~/lib/contract/operator-announcements.generated";

// Go does not register these sets; the contract types them as string.
const ANNOUNCEMENT_TYPE_VALUES = [
  "announcement",
  "release",
  "maintenance",
] as const;
const ANNOUNCEMENT_SEVERITY_VALUES = ["info", "warning", "critical"] as const;
const ANNOUNCEMENT_STATUS_VALUES = ["draft", "published", "expired"] as const;
const SYSTEM_ROLE_VALUES = ["admin", "user", "guardian"] as const;

export type AnnouncementType = (typeof ANNOUNCEMENT_TYPE_VALUES)[number];
export type AnnouncementSeverity =
  (typeof ANNOUNCEMENT_SEVERITY_VALUES)[number];
type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUS_VALUES)[number];
export type SystemRole = (typeof SYSTEM_ROLE_VALUES)[number];

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  admin: ROLE_LABELS.admin.name,
  user: ROLE_LABELS.user.name,
  guardian: ROLE_LABELS.guardian.name,
};

/** The label of a target role; „–“ for one this build does not know. */
export function systemRoleLabel(role: string): string {
  return labelOf(SYSTEM_ROLE_LABELS, knownEnum(SYSTEM_ROLE_VALUES, role), "–");
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  severity: AnnouncementSeverity;
  version: string | null;
  active: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  /**
   * Kept verbatim, also a role this build does not know: saving the
   * announcement sends them back, and an empty list means "everyone".
   */
  targetRoles: string[];
  targetOrgIds: string[];
  targetTenantIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** undefined: a status this build does not know. */
  status: AnnouncementStatus | undefined;
}

export interface AnnouncementViewDetail {
  userId: string;
  userName: string;
  seenAt: string;
  shownAt: string | null;
  dismissedAt: string | null;
  dismissed: boolean;
}

export function mapViewDetail(
  data: WireAnnouncementViewDetail,
): AnnouncementViewDetail {
  return {
    userId: data.user_id,
    userName: data.user_name,
    seenAt: data.seen_at,
    shownAt: data.shown_at,
    dismissedAt: data.dismissed_at,
    dismissed: data.dismissed,
  };
}

export type CreateAnnouncementRequest = WireCreateAnnouncementRequest & {
  title: string;
  content: string;
  type: AnnouncementType;
  severity: AnnouncementSeverity;
};

export type UpdateAnnouncementRequest = WireUpdateAnnouncementRequest & {
  title: string;
  content: string;
  type: AnnouncementType;
  severity: AnnouncementSeverity;
};

export function mapAnnouncement(data: WireAnnouncement): Announcement {
  return {
    id: data.id,
    title: data.title,
    content: data.content,
    // Go itself stores an empty type as "announcement" and an empty
    // severity as "info"; both only pick the badge.
    type: knownEnum(ANNOUNCEMENT_TYPE_VALUES, data.type) ?? "announcement",
    severity: knownEnum(ANNOUNCEMENT_SEVERITY_VALUES, data.severity) ?? "info",
    version: data.version ?? null,
    active: data.active,
    publishedAt: data.published_at ?? null,
    expiresAt: data.expires_at ?? null,
    targetRoles: data.target_roles ?? [],
    targetOrgIds: data.target_org_ids ?? [],
    targetTenantIds: data.target_tenant_ids ?? [],
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    status: knownEnum(ANNOUNCEMENT_STATUS_VALUES, data.status),
  };
}

export const TYPE_LABELS: Record<AnnouncementType, string> = {
  announcement: "Ankündigung",
  release: "Release",
  maintenance: "Wartung",
};

export const SEVERITY_LABELS: Record<AnnouncementSeverity, string> = {
  info: "Info",
  warning: "Warnung",
  critical: "Kritisch",
};

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  expired: "Abgelaufen",
};
