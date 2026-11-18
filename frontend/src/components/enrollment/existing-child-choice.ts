import { ApiError } from "~/lib/api-error";
import type {
  AdminCandidatePhaseRequest,
  AdminExistingChildCandidate,
  AdminRequestChild,
  ExistingChildChoice,
} from "~/lib/enrollment-admin-api";
import { formatCalendarDate } from "~/lib/localized-date-format";
import { schoolClassLabel } from "~/lib/school-class-label";

// A child that may already be enrolled asks the office before the approval
// (#6053): renew an enrolled child or create a new one. An existing_students
// phase offers no new child. The manual enrollment asks the same question
// when its approval is refused with the candidates (#6148). A candidate that
// another enrollment of the same phase already holds cannot be renewed
// again: the enrollment is a duplicate, and the office refuses it (#6247).

/** What the choice dialog needs to know about the child. */
export type ExistingChildChoiceSubject = Pick<
  AdminRequestChild,
  | "first_name"
  | "last_name"
  | "possible_existing_children"
  | "existing_child_only"
>;

/** Whether approving the child needs the office's choice first. */
export function needsExistingChildChoice(child: AdminRequestChild): boolean {
  return (
    child.existing_child_choice_required === true ||
    (child.possible_existing_children?.length ?? 0) > 0
  );
}

/**
 * The parent's own relationship pinned the child at submission, and the
 * school removed it since: the pin no longer authorizes the family.
 */
function parentMayNoLongerEnroll(child: AdminRequestChild): boolean {
  return (
    child.existing_child_choice_required === true &&
    Boolean(child.matched_student_id)
  );
}

/** The guardian's name of an enrollment, as the family wrote it. */
export function phaseRequestGuardian(request: AdminCandidatePhaseRequest) {
  return `${request.guardian_first_name} ${request.guardian_last_name}`.trim();
}

/**
 * The first candidate another enrollment of the same phase already holds
 * (#6247): the child is in the phase already, so this enrollment is a
 * duplicate of that one.
 */
function heldCandidate(
  child: Pick<AdminRequestChild, "possible_existing_children">,
):
  | (AdminExistingChildCandidate & {
      phase_request: AdminCandidatePhaseRequest;
    })
  | null {
  const held = child.possible_existing_children?.find(
    (candidate) => candidate.phase_request,
  );
  return held?.phase_request
    ? { ...held, phase_request: held.phase_request }
    : null;
}

/** What the office reads on the child's card before it decides. */
export interface ExistingChildHint {
  readonly title?: string;
  readonly message: string;
  /** The enrollment duplicates another one of the phase (#6247). */
  readonly duplicate: boolean;
  /** The card lists the enrolled children it compares with. */
  readonly listsCandidates: boolean;
}

export function existingChildHint(
  child: AdminRequestChild,
  requestGuardian?: string,
): ExistingChildHint | null {
  if (parentMayNoLongerEnroll(child)) {
    return {
      message:
        "Dieser Elternteil darf das Kind nicht mehr anmelden. Prüfe bitte die Angaben.",
      duplicate: false,
      listsCandidates: false,
    };
  }
  const count = child.possible_existing_children?.length ?? 0;
  if (count === 0) return null;
  const name = `${child.first_name} ${child.last_name}`;
  const held = heldCandidate(child);
  if (held) {
    const guardian = requestGuardian?.trim() || "den Elternteil";
    return {
      title: `${name} ist in dieser Phase schon angemeldet`,
      message: [
        `${phaseRequestGuardian(held.phase_request)} hat ${child.first_name} schon angemeldet.`,
        "Ist es dasselbe Kind, lehne diese Anmeldung ab.",
        `Trage ${guardian} dann in der Akte als Elternteil ein.`,
      ].join(" "),
      duplicate: true,
      listsCandidates: true,
    };
  }
  return {
    title: `${name} ist vielleicht schon angemeldet`,
    message:
      count === 1
        ? "In moto gibt es schon ein Kind mit diesem Namen und Geburtsdatum. Beim Bestätigen wählst du, ob es dasselbe Kind ist."
        : `In moto gibt es schon ${count} Kinder mit diesem Namen und Geburtsdatum. Beim Bestätigen wählst du, ob eines davon dasselbe Kind ist.`,
    duplicate: false,
    listsCandidates: true,
  };
}

/**
 * The reason of a refused duplicate. Parents may read it, so it names no
 * other family.
 */
export const DUPLICATE_ENROLLMENT_REASON =
  "Dein Kind ist schon über eine andere Anmeldung angemeldet.";

/** Class and birthday of a candidate, for the card and the dialog. */
export function candidateFacts(candidate: AdminExistingChildCandidate): string {
  return [
    candidate.school_class ? schoolClassLabel(candidate.school_class) : "",
    candidate.date_of_birth
      ? `geboren am ${formatCalendarDate(candidate.date_of_birth, "de-DE")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The dialog value that refuses the enrollment as a duplicate (#6247). */
export const REJECT_DUPLICATE_CHOICE = "reject-duplicate";

/** Whether every candidate is held by another enrollment of the phase. */
function onlyHeldCandidates(child: ExistingChildChoiceSubject): boolean {
  const candidates = child.possible_existing_children ?? [];
  return candidates.length > 0 && candidates.every((c) => c.phase_request);
}

export function existingChildChoiceDescription(
  child: ExistingChildChoiceSubject,
  options: { canRejectDuplicate?: boolean } = {},
): string {
  const hasCandidates = (child.possible_existing_children?.length ?? 0) > 0;
  const existingOnly = child.existing_child_only === true;
  if (!hasCandidates) {
    return existingOnly
      ? "Zu diesen Angaben wurde kein angemeldetes Kind gefunden. Diese Anmeldung ist nur für Kinder, die schon angemeldet sind. Prüfe Name und Geburtsdatum. Sonst lehne die Anmeldung ab."
      : "Zu diesen Angaben wurde kein angemeldetes Kind gefunden. Prüfe Name und Geburtsdatum. Ist das Kind schon vorhanden, wähle „Abbrechen“.";
  }
  const held = heldCandidate(child);
  if (held && onlyHeldCandidates(child)) {
    const next = options.canRejectDuplicate
      ? "Ist es dasselbe Kind, lehne diese Anmeldung als doppelt ab."
      : "Ist es dasselbe Kind, brich ab.";
    return `${phaseRequestGuardian(held.phase_request)} hat ${child.first_name} ${child.last_name} in dieser Phase schon angemeldet. ${next}`;
  }
  const base = `Bitte wähle für ${child.first_name} ${child.last_name}. Beim bestehenden Kind wird nur die Anmeldung verlängert. Die Eltern aus dieser Anmeldung bekommen dadurch keinen Zugang zum Kind.`;
  return existingOnly
    ? `${base} Ist es ein anderes Kind, lehne die Anmeldung ab.`
    : base;
}

export function existingChildChoiceOptions(
  child: ExistingChildChoiceSubject,
  options: { canRejectDuplicate?: boolean } = {},
) {
  const candidates = (child.possible_existing_children ?? []).map(
    (candidate) => {
      const held = candidate.phase_request;
      return {
        value: candidate.student_id,
        label: "Bestehendes Kind verwenden",
        description: [
          `${candidate.first_name} ${candidate.last_name}`,
          candidateFacts(candidate),
          held ? `schon angemeldet von ${phaseRequestGuardian(held)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        // The phase takes the child once; renewing it again is refused.
        ...(held
          ? {
              disabled: true,
              disabledReason:
                "Das Kind ist in dieser Phase schon angemeldet. Lehne diese Anmeldung ab.",
            }
          : {}),
      };
    },
  );
  const newChild =
    child.existing_child_only === true
      ? []
      : [
          {
            value: "new",
            label: "Als neues Kind anlegen",
            description: "Wähle dies nur, wenn es ein anderes Kind ist.",
          },
        ];
  // A duplicate of another enrollment of the phase is refused right here,
  // the likely answer, instead of a dead end behind „Abbrechen“.
  const rejectDuplicate =
    options.canRejectDuplicate && heldCandidate(child)
      ? [
          {
            value: REJECT_DUPLICATE_CHOICE,
            label: "Als doppelt ablehnen",
            description:
              "Lehnt diese doppelte Anmeldung sofort ab. Die Eltern lesen: Dein Kind ist schon angemeldet.",
            primary: true,
          },
        ]
      : [];
  return [...candidates, ...rejectDuplicate, ...newChild];
}

/**
 * The office's answer to the choice dialog: an enrolled child, or a new
 * child together with every candidate the dialog showed (#6247).
 */
export function existingChildChoiceOf(
  value: string,
  child: Pick<ExistingChildChoiceSubject, "possible_existing_children">,
): ExistingChildChoice {
  return value === "new"
    ? {
        createNewStudent: true,
        shownStudentIds: (child.possible_existing_children ?? []).map(
          (candidate) => candidate.student_id,
        ),
      }
    : { existingStudentId: value };
}

function isCandidate(value: unknown): value is AdminExistingChildCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.student_id === "string" &&
    typeof candidate.first_name === "string" &&
    typeof candidate.last_name === "string"
  );
}

/**
 * The enrolled children a refused approval names (#6148), or null when the
 * error is no such refusal or carries no usable candidate.
 */
export function possiblyEnrolledCandidates(
  error: unknown,
): AdminExistingChildCandidate[] | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== "enrollment.child_possibly_enrolled"
  ) {
    return null;
  }
  const raw = error.details?.candidates;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isCandidate)) {
    return null;
  }
  return raw;
}

/** How often one approval asks the office before it gives up. */
const MAX_EXISTING_CHILD_QUESTIONS = 3;

/**
 * Sends an approval that may meet an already enrolled child: on the refusal
 * with candidates it asks the office and sends again with the answer. A new
 * child can be refused once more when another child was enrolled meanwhile
 * (#6247); then the office is asked again with the current candidates.
 * Null means the office cancelled and nothing was saved.
 */
export async function sendWithExistingChildChoice<T>(
  send: (choice?: ExistingChildChoice) => Promise<T>,
  ask: (
    candidates: AdminExistingChildCandidate[],
  ) => Promise<ExistingChildChoice | null>,
): Promise<T | null> {
  let choice: ExistingChildChoice | undefined;
  for (let asked = 0; ; asked++) {
    try {
      return await send(choice);
    } catch (error) {
      const candidates = possiblyEnrolledCandidates(error);
      if (!candidates || asked >= MAX_EXISTING_CHILD_QUESTIONS) throw error;
      const answer = await ask(candidates);
      if (!answer) return null;
      choice = answer;
    }
  }
}

/**
 * The name of the enrolled child the office chose to renew, as the school
 * knows it; null when the office chose no enrolled child.
 */
export function renewedChildNameOf(
  choice: ExistingChildChoice | undefined,
  candidates: readonly AdminExistingChildCandidate[],
): string | null {
  if (!choice || !("existingStudentId" in choice)) return null;
  const chosen = candidates.find(
    (candidate) => candidate.student_id === choice.existingStudentId,
  );
  return chosen ? `${chosen.first_name} ${chosen.last_name}` : null;
}
