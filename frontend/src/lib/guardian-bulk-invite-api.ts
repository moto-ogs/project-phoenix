import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "~/lib/contract/known-enum";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "GuardianBulkInviteAPI" });

const PROBLEM_REASONS = [
  "missing_email",
  "invalid_email",
  "duplicate_email",
  "email_not_queued",
  "address_blocked",
  "provider_blocked",
  "block_unreadable",
  "mail_delayed",
] as const;
type BulkInviteProblemReason = (typeof PROBLEM_REASONS)[number];

export interface BulkInviteProblem {
  guardianProfileId: string;
  guardianName: string;
  studentNames: string[];
  reason: BulkInviteProblemReason;
}

/** Counts guardians, never children: a parent of three selected children is
 *  invited once and counted once. */
export interface BulkInviteResult {
  dryRun: boolean;
  invited: number;
  linkedExistingAccount: number;
  resent: number;
  skippedActive: number;
  skippedOpen: number;
  skippedRestricted: number;
  problems: BulkInviteProblem[];
}

/**
 * Invite the guardians of many children to the parents portal in one run
 * (#3378). `dryRun` only counts and mails nobody; `resendOpen` also mails
 * guardians whose invitation is still open and restarts its expiry.
 */
export async function bulkInviteGuardians(
  studentIds: string[],
  options: { dryRun: boolean; resendOpen: boolean },
): Promise<BulkInviteResult> {
  const data = await bffJson("tenant", "POST /api/guardians/bulk-invite", {
    body: {
      student_ids: studentIds,
      dry_run: options.dryRun,
      resend_open: options.resendOpen,
    },
    errorMessage: "Failed to bulk invite guardians",
  }).catch((error: unknown) => {
    logger.warn("bulk_invite_guardians_failed", {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  });
  return {
    dryRun: data.dry_run,
    invited: data.invited,
    linkedExistingAccount: data.linked_existing_account,
    resent: data.resent,
    skippedActive: data.skipped_active,
    skippedOpen: data.skipped_open,
    skippedRestricted: data.skipped_restricted,
    problems: (data.problems ?? []).map((problem) => ({
      guardianProfileId: problem.guardian_profile_id,
      guardianName: problem.guardian_name,
      studentNames: problem.student_names ?? [],
      // A reason this build does not know reads as "not sent".
      reason: knownEnum(PROBLEM_REASONS, problem.reason) ?? "email_not_queued",
    })),
  };
}
