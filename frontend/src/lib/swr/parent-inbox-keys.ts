import { parentKeys } from "./parent-keys";

/**
 * Elternportal, Postfach und Verträge: Neuigkeiten, Nachrichten, Dokumente, Speiseplan, Verträge, Lastschrift.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 * Every key starts with `parent-`, so `parentKeys.isResource` withdraws it
 * when a guardian's access is refused. The announcement feed, message
 * threads and group threads live in `parentKeys`.
 */
export const parentInboxKeys = {
  /** The attachments of one announcement (#2890). */
  announcementAttachments: (announcementId: string) =>
    `parent-announcement-attachments-${encodeURIComponent(announcementId)}`,
  /** This account's proof of an Einverständnis for one child (#3430). */
  declarationProof: (announcementId: string, studentId: string) =>
    `parent-declaration-proof-${encodeURIComponent(announcementId)}-${encodeURIComponent(studentId)}`,
  /** The documents inbox: letters, care contracts and released documents (#4671). */
  documents: () => "parent-documents",
  /** What one care contract allows to end today (#4682); read per Berlin day. */
  contractNoticeOptions: (
    organizationId: string,
    contractId: string,
    day: string,
  ) =>
    `parent-contract-notice-options-${encodeURIComponent(organizationId)}-${encodeURIComponent(contractId)}-${day}`,
  /** The family's SEPA mandate for one care contract (#4696). */
  sepaMandate: (organizationId: string, contractId: string) =>
    `parent-sepa-mandate-${encodeURIComponent(organizationId)}-${encodeURIComponent(contractId)}`,
  /** The schools and phases this account may enroll a child at. */
  enrollableSchools: () => "parent-enrollable-schools",
  /** One group message of the OGS with the guardian's children it reached (#4784). */
  groupThread: (groupThreadId: string) =>
    `parent-group-thread-${encodeURIComponent(groupThreadId)}`,
  /** Both conversations of one child with the OGS, with unread counts (#5200). */
  childThreads: (studentId: string) =>
    `parent-child-threads-${encodeURIComponent(studentId)}`,
  /**
   * The coming Elternsprechtage of one child's class (#4801). The child page
   * reads the same response, so a booking refreshes both.
   */
  conferences: (studentId: string) => parentKeys.conferences(studentId),
  /** The meal plan of one child's school for the week from `monday`. */
  mealPlan: (studentId: string, monday: string) =>
    `parent-meal-plan-${encodeURIComponent(studentId)}-${monday}`,
} as const;
