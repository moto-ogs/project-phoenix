import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import * as enrollment from "~/lib/contract/enrollment.generated";
import * as holidayRegistration from "~/lib/contract/traeger-holiday-registrations.generated";
import {
  formatEnrollmentChangeRequestDiff,
  formLabelsFromContract,
  localizeEnrollmentFormLabels,
} from "~/lib/enrollment-change-request-diff";
import { enrollmentStatusDiffCopy } from "~/lib/enrollment-status-diff-copy";
import {
  changeRequestFromContract,
  statusFromContract,
  type EnrollmentStatusDisplay,
} from "~/lib/enrollment-submission-api";
import { holidayRegistrationStatusFromBackend } from "~/lib/holiday-registration-status-api";
import { createLogger } from "~/lib/logger";
import { readContract, withRequestBudget } from "~/lib/server-seed.server";
import type {
  EnrollmentStatusChangeRequest,
  EnrollmentStatusSeedData,
  TokenStatusSeed,
} from "~/lib/token-status-seed";

const logger = createLogger({ component: "TokenStatusSeed" });

async function seedStatus<T>(
  read: () => Promise<T | undefined>,
): Promise<TokenStatusSeed<T> | undefined> {
  const incoming = await headers();
  // These links make a fresh capability check when opened. A speculative
  // render must not spend the link's rate limit or put its data in the cache.
  if (
    incoming.has("next-router-prefetch") ||
    incoming.has("next-router-segment-prefetch") ||
    incoming.get("purpose") === "prefetch" ||
    incoming.get("sec-purpose")?.includes("prefetch")
  ) {
    return undefined;
  }

  const builtAt = Date.now();
  const data = await read();
  return data === undefined ? undefined : { builtAt, data };
}

function readStatusPart<T>(
  name: string,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  return withRequestBudget(read, {
    timeout: () => logger.warn("token_status_seed_timeout", { field: name }),
    failed: () => logger.debug("token_status_seed_skipped", { field: name }),
  });
}

export function readHolidayRegistrationStatusSeed(token: string) {
  return seedStatus(() =>
    readStatusPart("holidayRegistration.status", async (signal) => {
      const { data } = await readContract(
        holidayRegistration.routes[
          "GET /traeger/holiday-registrations/status/{statusToken}"
        ],
        { params: { statusToken: token }, signal },
      );
      return holidayRegistrationStatusFromBackend(data);
    }),
  );
}

export function readEnrollmentStatusSeed(token: string) {
  return seedStatus<EnrollmentStatusSeedData>(async () => {
    const [status, localizedChanges] = await Promise.all([
      readEnrollmentStatus(token),
      // Formatting the optional diff must not discard a valid status.
      readEnrollmentChanges(token).catch(() => undefined),
    ]);
    return status === undefined ? undefined : { status, ...localizedChanges };
  });
}

function readEnrollmentStatus(token: string) {
  return readStatusPart(
    "enrollment.status",
    async (signal): Promise<EnrollmentStatusDisplay> => {
      const { data } = await readContract(
        enrollment.routes["GET /api/enrollment/requests/{statusToken}"],
        { params: { statusToken: token }, signal },
      );
      const {
        request_id: _requestId,
        signature,
        ...status
      } = statusFromContract(data);
      if (!signature) return status;
      const {
        document_sha256: _proofHash,
        image_png: _image,
        ...shownSignature
      } = signature;
      return { ...status, signature: shownSignature };
    },
  );
}

async function readEnrollmentChanges(
  statusToken: string,
): Promise<Pick<EnrollmentStatusSeedData, "changes" | "changesLocale">> {
  const changes = await readStatusPart(
    "enrollment.changeRequests",
    async (signal) => {
      const { data } = await readContract(
        enrollment.routes[
          "GET /api/enrollment/requests/{statusToken}/change-requests"
        ],
        { params: { statusToken }, signal },
      );
      return data.map(changeRequestFromContract);
    },
  );
  if (changes === undefined) return {};
  if (changes.length === 0) return { changes: [] };

  const [locale, t, labels] = await Promise.all([
    getLocale(),
    getTranslations("enrollmentStatus"),
    readStatusPart("enrollment.formLabels", async (signal) => {
      const { data } = await readContract(
        enrollment.routes[
          "GET /api/enrollment/requests/{statusToken}/form-labels"
        ],
        { params: { statusToken }, signal },
      );
      return formLabelsFromContract(data);
    }),
  ]);
  const formLabels = labels
    ? localizeEnrollmentFormLabels(labels, locale)
    : null;
  const copy = enrollmentStatusDiffCopy(t);
  // The diff renderer needs only formatted changes, not the submission
  // snapshots with every unchanged answer or IDs of the staff who reviewed it.
  const projected = changes.map((request): EnrollmentStatusChangeRequest => ({
    id: request.id,
    origin: request.origin,
    status: request.status,
    parent_note: request.parent_note,
    admin_decision_note: request.admin_decision_note,
    created_at: request.created_at,
    messages: request.messages
      ?.filter((message) => !message.internal_only)
      .map(({ id, author_type, body, created_at }) => ({
        id,
        author_type,
        body,
        created_at,
      })),
    groups: formatEnrollmentChangeRequestDiff({
      baseSnapshot: request.base_snapshot,
      proposedSnapshot: request.proposed_snapshot,
      diff: request.diff,
      copy,
      formLabels,
    }),
  }));
  return { changes: projected, changesLocale: locale };
}
