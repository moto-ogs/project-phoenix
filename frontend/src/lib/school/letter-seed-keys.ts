import {
  isDeclaration,
  isLetter,
  SCHOOL_PARENT_LETTERS_BASE,
  type Announcement,
} from "~/lib/parent-announcements-api";
import { hasLetterPlaceholders } from "~/lib/parent-letter-placeholders";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";

export const schoolLetterDetailKeys = {
  placeholders: () =>
    parentAnnouncementKeys.letterPlaceholders(SCHOOL_PARENT_LETTERS_BASE),
  letterStatus: (id: string) =>
    tenantContactKeys.letterStatus(id, SCHOOL_PARENT_LETTERS_BASE),
  declarationStatus: (id: string) =>
    tenantContactKeys.declarationStatus(id, SCHOOL_PARENT_LETTERS_BASE),
};

type Detail = keyof typeof schoolLetterDetailKeys;

/** Only the display panels the same letter renders, never the draft reach. */
export function schoolLetterDetails(letter: Announcement): Detail[] {
  const details: Detail[] = [];
  if (isLetter(letter)) {
    if (hasLetterPlaceholders(letter.body)) details.push("placeholders");
    if (letter.status !== "draft") details.push("letterStatus");
  }
  if (
    isDeclaration(letter) &&
    (letter.status !== "draft" || letter.declaration_locked_attachments)
  )
    details.push("declarationStatus");
  return details;
}
