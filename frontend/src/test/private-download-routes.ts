/**
 * Private, session- or token-bound file routes. Audited for #5119. A file
 * route the contract registers (`response: fileAnswer`) has no route file:
 * the portal's catalog proxy answers it private and uncached
 * (catalog-proxy.server.ts, #2352), and `route-cache-policy.test.ts` keeps
 * it out of this list.
 */
export const PRIVATE_DOWNLOAD_ROUTES = [
  ["announcement-attachments/[announcementId]/[attachmentId]/download", "GET"],
  ["enrollment/admin/requests/[id]/signature-proof", "GET"],
  ["enrollment/admin/requests/[id]/uploads/[uploadId]", "GET"],
  ["files/folders/[folderId]/files/[fileId]/download", "GET"],
  ["messages/attachments/[attachmentId]/download", "GET"],
  ["operator/billing/key-date-counts/export", "GET"],
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
    "parent/me/messages/children/[studentId]/attachments/[attachmentId]/download",
    "GET",
  ],
  [
    "parent/me/news/[announcementId]/attachments/[attachmentId]/download",
    "GET",
  ],
  ["parent/me/news/[announcementId]/declaration/proof/pdf", "GET"],
  ["school/class-day/absence-list/export", "GET"],
  ["school/parent-letters/[announcementId]/declaration-export", "GET"],
  ["school/parent-letters/[announcementId]/letters-pdf", "GET"],
  ["school/staff-messages/attachments/[attachmentId]/download", "GET"],
  ["staff-messages/attachments/[attachmentId]/download", "GET"],
  ["staff/[id]/documents/[documentId]/download", "GET"],
  ["staff/time-tracking/export", "GET"],
  ["students/[id]/accident-reports/[documentId]/pdf", "GET"],
  ["students/[id]/attendance-history/export", "GET"],
  ["students/[id]/documents/[documentId]/download", "GET"],
  ["students/care-schedule-change-requests/[requestId]/proof", "GET"],
  ["students/export", "POST"],
  ["traeger-documents/[id]/file", "GET"],
] as const;
