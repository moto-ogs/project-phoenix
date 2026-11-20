/**
 * Private, session- or token-bound file routes. Audited for #5119. A file
 * route the contract registers (`response: fileAnswer`) has no route file:
 * the portal's catalog proxy answers it private and uncached
 * (catalog-proxy.server.ts, #2352), and `route-cache-policy.test.ts` keeps
 * it out of this list.
 */
export const PRIVATE_DOWNLOAD_ROUTES = [
  ["enrollment/admin/requests/[id]/signature-proof", "GET"],
  ["parent-announcements/[announcementId]/declaration-export", "GET"],
  ["parent-announcements/[announcementId]/letters-pdf", "GET"],
  ["parent/calendar/appointments/[appointmentId]/ics", "GET"],
  [
    "parent/me/children/[studentId]/pickup-requests/[requestId]/proof/pdf",
    "GET",
  ],
  ["parent/me/documents/[organizationId]/[documentId]/pdf", "GET"],
  ["parent/me/documents/[organizationId]/contracts/[contractId]/pdf", "GET"],
  ["parent/me/documents/[organizationId]/shared/[documentId]/file", "GET"],
  [
    "parent/me/news/[announcementId]/attachments/[attachmentId]/download",
    "GET",
  ],
  ["parent/me/news/[announcementId]/declaration/proof/pdf", "GET"],
  ["school/class-day/absence-list/export", "GET"],
  ["school/parent-letters/[announcementId]/declaration-export", "GET"],
  ["school/parent-letters/[announcementId]/letters-pdf", "GET"],
  ["students/export", "POST"],
] as const;
