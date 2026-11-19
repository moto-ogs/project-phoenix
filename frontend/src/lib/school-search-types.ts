// The shapes of the school search (#6954), apart from `school-search` so that
// its wire mapping can name them without importing the client.
/**
 * The school search (#6954, ADR 0231). The query travels in a POST body and
 * never in a URL, so a phone number or a name stays out of access logs,
 * browser history and error reports.
 */

/** Why a row is in the list. */
export type SchoolSearchMatchField =
  | "name"
  | "class"
  | "group"
  | "parent_note"
  | "student_note"
  | "enrollment_answer"
  | "phone"
  | "email"
  | "contact";

export interface SchoolSearchMatch {
  readonly field: SchoolSearchMatchField;
  /** The registration question of an answer hit. */
  readonly label?: string;
  /**
   * The matched value as stored: a number, an address; a note or a long
   * answer as the part around the match.
   */
  readonly text?: string;
}

export interface SchoolSearchChild {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly schoolClass: string;
  readonly groupName?: string;
  readonly match: SchoolSearchMatch;
}

interface SchoolSearchContactChild {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly schoolClass: string;
  readonly relationshipType: string;
}

export interface SchoolSearchContact {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly match: SchoolSearchMatch;
  readonly children: readonly SchoolSearchContactChild[];
}

interface SchoolSearchStaff {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

interface SchoolSearchRoom {
  readonly id: string;
  readonly name: string;
  readonly building?: string;
}

interface SchoolSearchGroup {
  readonly id: string;
  readonly name: string;
}

/**
 * What this account may find, as the server decided it from its rights. It
 * depends on the account only, never on the hits.
 */
export interface SchoolSearchScope {
  readonly children: boolean;
  readonly childDetails: boolean;
  readonly contacts: boolean;
  readonly staff: boolean;
  readonly rooms: boolean;
  readonly groups: boolean;
}

export interface SchoolSearchResult {
  readonly children: readonly SchoolSearchChild[];
  readonly contacts: readonly SchoolSearchContact[];
  readonly staff: readonly SchoolSearchStaff[];
  readonly rooms: readonly SchoolSearchRoom[];
  readonly groups: readonly SchoolSearchGroup[];
  readonly scope: SchoolSearchScope;
}
