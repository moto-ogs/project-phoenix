import {
  mapParentConferenceOffer,
  type ParentConferenceOffer,
} from "~/lib/parent-conferences";
import {
  type HolidayRegistrationEntry,
  holidayRegistrationEntriesFromBackend,
} from "~/lib/parent-holiday-registration-entries";
import type * as parentMeContract from "./contract/parent-me.generated";
import type * as sharedContract from "./contract/shared.generated";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import { bffFileHref, bffFile, bffJson } from "./bff-fetch";
import { ApiError } from "./api-error";
/**
 * Parent-portal client API. Symmetric to the operator-api / tenant
 * api-helpers split. Every call goes through a Next.js proxy route
 * under /api/parent/* which forwards (with the parent NextAuth
 * session token) to the backend /parent/* endpoints.
 *
 * Types here mirror backend/api/parent/me_handlers.go. int64 ids
 * arrive as strings per the project's frontend convention.
 */

import type { AppLocale } from "~/i18n/locales";
import type {
  SurveyAnswersRequest,
  SurveyForm,
  SurveyQuestionKind,
} from "~/lib/survey-form";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import {
  normalizeMealAllergens,
  type MealAllergen,
} from "~/lib/meal-allergens";
import {
  type ChatMessage,
  type MessageAudience,
  type MessageKind,
  type SchoolReaders,
  chatMessageFieldsOf,
  knownMessageKind,
  knownSenderKind,
} from "~/lib/messaging-status";
import { logEnrollmentFailure } from "~/lib/enrollment-api-error";
import { type SignatureValue, signatureRequestBody } from "~/lib/signature";
import type { MeProfileResponse } from "~/lib/enrollment-submission-api";

import { boundSessionAccount } from "~/lib/session-account";
import {
  type ContractNoticeOptions,
  declarationBody,
  type NoticeDeclaration,
  noticeOptionsFromBackend,
} from "~/lib/care-contract-notices";
import {
  isParentAccessRefusal,
  PARENT_ACCESS_REFUSED_EVENT,
} from "~/lib/parent-access-refusal";

const logger = createLogger({ component: "ParentAPI" });

// The two absence kinds a parent can report: "sick" (Krankmeldung, flips the
// live sick flag) or "excused" (Termin/Abwesenheit, no live flag).
export type StudentStatusKind = "sick" | "excused";

export type ParentRequestShareType =
  "master_data" | "care_schedule" | "pickup_change" | "offering" | "excused";

/** Reads the history of one request (oldest first). */
export async function listParentRequestEvents(
  studentId: string,
  requestType: ParentRequestShareType,
  requestId: string,
): Promise<parentMeContract.ParentRequestEventResponse[]> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/requests/{requestType}/{requestId}/events",
      { params: { studentId, requestType, requestId } },
    ),
  );
}

export async function getRequestSharingOptions(
  studentId: string,
): Promise<parentMeContract.requestSharingResponse> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/request-sharing-options",
      { params: { studentId } },
    ),
  );
}

export async function getRequestSharing(
  studentId: string,
  requestType: ParentRequestShareType,
  requestId: string,
): Promise<parentMeContract.requestSharingStateResponse> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/request-sharing/{requestType}/{requestId}",
      { params: { studentId, requestType, requestId } },
    ),
  );
}

/**
 * Replaces who sees the request. `expectedVersion` is the `version` of the
 * sharing the choice was made on; a changed one answers 409
 * `general.changed_since_read` (ADR 0311).
 */
export async function setRequestSharing(
  studentId: string,
  requestType: ParentRequestShareType,
  requestId: string,
  recipientGuardianProfileIds: string[],
  expectedVersion: string,
): Promise<parentMeContract.requestSharingStateResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/request-sharing/{requestType}/{requestId}",
      {
        params: { studentId, requestType, requestId },
        body: {
          recipient_guardian_profile_ids: recipientGuardianProfileIds,
          expected_version: expectedVersion,
        },
      },
    ),
  );
}

// One dish of the read-only meal plan (Essensplan) for a child's school.
// Mirrors api/parent.MealPlanEntryResponse. A day can carry several dishes.
export interface MealPlanEntry {
  readonly date: string; // YYYY-MM-DD
  readonly position: number;
  readonly dish: string;
  readonly note?: string | null;
  /** Codes of the main allergens, in legend order; empty when unmarked. */
  readonly allergens: readonly MealAllergen[];
}

// Abholarten, die Eltern für einen einzelnen Tag anfragen können (#3945).
// „In Begleitung“ setzt nur die OGS, weil sie das Begleitkind verknüpft.
export const REQUESTABLE_DAY_DEPARTURE_MODES = [
  "alone",
  "bus",
  "pickup",
] as const;
export type DayDepartureMode =
  (typeof REQUESTABLE_DAY_DEPARTURE_MODES)[number] | "accompanied";

/**
 * Records a failed parent request: the access-refused event when the
 * account that sent it is still the signed-in one, and the log line. The
 * log carries status and code, never the path with its IDs.
 */
function noteParentFailure(
  error: ApiError,
  origin: { account: string | null; method: string },
  checksPortalAccess: boolean,
): void {
  if (
    typeof window !== "undefined" &&
    origin.account &&
    origin.account === boundSessionAccount() &&
    isParentAccessRefusal(error, origin.method, checksPortalAccess)
  ) {
    window.dispatchEvent(
      new CustomEvent(PARENT_ACCESS_REFUSED_EVENT, {
        detail: { account: origin.account, error },
      }),
    );
  }
  const context = { status: error.status, code: error.code };
  if (error.status === 401) {
    logger.warn("parent_api_request_failed", context);
  } else {
    logger.error("parent_api_request_failed", context);
  }
}

/**
 * Watches a JSON call of the parent portal (#7806). bffJson sends, decodes
 * and bounces a 401 to the login; this adds what only the parent portal
 * does with a failure (noteParentFailure). `checksPortalAccess` marks the
 * reads that require only parent_portal.access.
 */
async function parentCall<T>(
  call: Promise<T>,
  checksPortalAccess = false,
): Promise<T> {
  const account = boundSessionAccount();
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError) {
      noteParentFailure(error, { account, method: "GET" }, checksPortalAccess);
    }
    throw error;
  }
}

/**
 * Fetches every child linked to the calling parent's account, across
 * every active tenant mapping. The response is already sorted (school
 * to first name to last name) by the backend.
 */
export async function listMyChildren(): Promise<
  parentMeContract.ChildResponse[]
> {
  return parentCall(bffJson("parent", "GET /parent/me/children"));
}

/** Reads the four current consent and acknowledgement states for one child. */
export async function getChildConsents(
  studentId: string,
): Promise<parentMeContract.ChildConsentResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/consents", {
      params: { studentId },
    }),
  );
}

/** Withdraws the voluntary photo consent and returns all updated states. */
export async function withdrawChildPhotoConsent(
  studentId: string,
): Promise<parentMeContract.ChildConsentResponse[]> {
  return parentCall(
    bffJson("parent", "DELETE /parent/me/children/{studentId}/consents/photo", {
      params: { studentId },
    }),
  );
}

/** Records a new voluntary photo consent and returns all updated states. */
export async function grantChildPhotoConsent(
  studentId: string,
): Promise<parentMeContract.ChildConsentResponse[]> {
  return parentCall(
    bffJson("parent", "PUT /parent/me/children/{studentId}/consents/photo", {
      params: { studentId },
    }),
  );
}

/** Reads the stop of the child's room history and mood. */
export async function getChildRoomHistoryStop(
  studentId: string,
): Promise<parentMeContract.ChildRoomHistoryStopResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/room-history-stop", {
      params: { studentId },
    }),
  );
}

/**
 * Stops the room history and mood of the child; moto deletes the child's
 * room history.
 */
export async function stopChildRoomHistory(
  studentId: string,
): Promise<parentMeContract.ChildRoomHistoryStopResponse> {
  return parentCall(
    bffJson("parent", "PUT /parent/me/children/{studentId}/room-history-stop", {
      params: { studentId },
    }),
  );
}

/** Lifts the stop; moto records again from now on. */
export async function resumeChildRoomHistory(
  studentId: string,
): Promise<parentMeContract.ChildRoomHistoryStopResponse> {
  return parentCall(
    bffJson(
      "parent",
      "DELETE /parent/me/children/{studentId}/room-history-stop",
      { params: { studentId } },
    ),
  );
}

/** The coming Elternsprechtage of the child's class (#4801). */
export async function fetchChildParentConferences(
  studentId: string,
): Promise<ParentConferenceOffer[]> {
  const offers = await parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/parent-conferences",
      {
        params: { studentId },
      },
    ),
  );
  return (offers ?? []).map(mapParentConferenceOffer);
}

/** Books the slot for the child, or moves the child's booking there. */
export async function bookChildParentConference(
  studentId: string,
  conferenceId: string,
  startTime: string,
): Promise<ParentConferenceOffer> {
  return mapParentConferenceOffer(
    await parentCall(
      bffJson(
        "parent",
        "PUT /parent/me/children/{studentId}/parent-conferences/{conferenceId}/booking",
        {
          params: { studentId, conferenceId },
          body: { start_time: startTime },
        },
      ),
    ),
  );
}

/** Cancels the child's booking of the day. */
export async function cancelChildParentConference(
  studentId: string,
  conferenceId: string,
): Promise<void> {
  await parentCall(
    bffJson(
      "parent",
      "DELETE /parent/me/children/{studentId}/parent-conferences/{conferenceId}/booking",
      { params: { studentId, conferenceId } },
    ),
  );
}

/**
 * Fetches the enrollment phases the calling parent's account may apply to,
 * across every school (linked or not). The backend pre-filters by eligibility
 * and pre-sorts (already-linked schools first, then by school name and service
 * start), so the picker renders the list as-is. Powers the "Neue Anmeldung"
 * picker at /parents/anmeldung.
 */
export async function listEnrollableSchools(): Promise<
  parentMeContract.EnrollablePhaseResponse[]
> {
  return parentCall(bffJson("parent", "GET /parent/me/enrollable-schools"));
}

export async function fetchParentProfile(): Promise<parentMeContract.ParentProfileResponse> {
  return parentCall(bffJson("parent", "GET /parent/me/profile"));
}

export async function updateParentPortalLocale(
  locale: AppLocale,
): Promise<parentMeContract.ParentProfileResponse> {
  return parentCall(
    bffJson("parent", "PUT /parent/me/profile", {
      body: { portal_locale: locale },
    }),
  );
}

/**
 * Fetches the parent's autofill payload for the embedded enrollment
 * form, scoped to a specific tenant slug. Returns null on 401 so the
 * form can render without prefill rather than failing.
 */
export async function fetchParentEnrollmentProfile(
  tenantSlug: string,
): Promise<MeProfileResponse | null> {
  try {
    const profile = await bffJson(
      "parent",
      "GET /parent/enrollments/{tenantSlug}/profile",
      {
        params: { tenantSlug },
        errorMessage: "Profil konnte nicht geladen werden",
        // Without a session the form renders without prefill; the class code
        // of a BFF without session keeps the page (no login redirect).
        authRefusals: ["general.permission"],
      },
    );
    return { ...profile, children: profile.children ?? [] };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    return logEnrollmentFailure(error, logger, "parent_profile_request_failed");
  }
}

/**
 * Submits an enrollment from the parents portal. Backend stamps
 * guardian_account_id from the parent JWT and skips captcha
 * verification. The JWT itself is the anti-bot signal. Reuses the
 * same payload + result shape as the public submitEnrollment so the
 * EnrollmentForm can consume both paths interchangeably.
 */
export async function submitParentEnrollment(
  tenantSlug: string,
  payload: sharedContract.SubmitEnrollmentRequest,
): Promise<sharedContract.SubmitEnrollmentResponse> {
  return bffJson("parent", "POST /parent/enrollments/{tenantSlug}/submit", {
    params: { tenantSlug },
    body: payload,
    errorMessage: "Anmeldung konnte nicht übermittelt werden",
  }).catch((error: unknown) =>
    logEnrollmentFailure(error, logger, "parent_submit_failed"),
  );
}

/**
 * Reports the child absent for one or more dates (YYYY-MM-DD) with the chosen
 * status: "sick" (Krankmeldung, flips the live sick flag when effective) or
 * "excused" (Termin/Abwesenheit, no live flag). Direct submissions return the
 * recorded days; approval-gated submissions return no day and the pending
 * request. The backend
 * verifies the caller is a guardian of the child and that the school has the
 * feature enabled. A trimmed reason is required for both absence types; a
 * disabled school surfaces as a thrown error.
 */
export async function submitSickNote(
  studentId: string,
  dates: string[],
  reason: string,
  status: StudentStatusKind = "sick",
  recipientGuardianProfileIds: string[] = [],
): Promise<parentMeContract.SickNoteEnvelopeResponse> {
  // The backend answers {status_days, pending_request} (#2352).
  return parentCall(
    bffJson("parent", "POST /parent/me/children/{studentId}/sick-note", {
      params: { studentId },
      body: {
        dates,
        reason,
        status,
        recipient_guardian_profile_ids: recipientGuardianProfileIds,
      },
    }),
  );
}

/**
 * Changes the guardian's own still-pending absence request. `expectedVersion`
 * is the `version` of the list row the values came from; the backend answers
 * 409 `general.changed_since_read` when the request moved on meanwhile.
 */
export async function updateExcusedRequest(
  studentId: string,
  requestId: string,
  input: { dates: string[]; note: string; expectedVersion: string },
): Promise<parentMeContract.ParentExcusedRequestResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/excused-requests/{requestId}",
      {
        params: { studentId, requestId },
        body: {
          dates: input.dates,
          note: input.note,
          expected_version: input.expectedVersion,
        },
      },
    ),
  );
}

/**
 * Lists the child's absence requests that went through an OGS approval gate,
 * newest first. Powers the pending and recently decided summary lines.
 */
export async function listExcusedRequests(
  studentId: string,
): Promise<parentMeContract.ParentExcusedRequestResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/excused-requests", {
      params: { studentId },
    }),
  );
}

/**
 * Fetches which write actions the child's school allows (resolved per
 * tenant). Used to hide/disable actions the backend would reject. Defaults
 * to both enabled if the request fails, so a transient error doesn't lock a
 * parent out of an enabled feature.
 */
export async function getChildFeatures(
  studentId: string,
): Promise<parentMeContract.ChildFeaturesResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/features", {
      params: { studentId },
    }),
    true, // This endpoint requires only parent_portal.access.
  );
}

/** Was angezeigt wird, solange oder falls der Endpunkt nichts liefert. */
export const UNKNOWN_CHILD_TODAY: parentMeContract.TodayStatusResponse = {
  at_ogs: null,
  state: "unknown",
};

/**
 * Holt den Tagesstatus des Kindes.
 *
 * Faellt auf `unknown` zurueck, statt zu werfen: der Endpunkt kann fehlen
 * (404, waehrend das Backend nachzieht) oder der Zugriff auf das Kind ist
 * entzogen (403). Beides ist "wir wissen es nicht", kein Fehlerzustand, den ein
 * Elternteil sehen muesste. 401 laesst bffJson weiterhin zur
 * Anmeldung umleiten.
 *
 * Genau diese zwei Codes, nicht "ab 403": ein 500er oder ein ausgefallener
 * Proxy ist ein echter Fehler und darf nicht als gueltiger Unbekannt-Zustand
 * durchgehen. Alle Aufrufer fangen den Wurf ab und zeigen weiterhin
 * UNKNOWN_CHILD_TODAY — nur bleibt der Ausfall jetzt als Fehler sichtbar.
 */
export async function getChildToday(
  studentId: string,
): Promise<parentMeContract.TodayStatusResponse> {
  try {
    return await parentCall(
      bffJson("parent", "GET /parent/me/children/{studentId}/today", {
        params: { studentId },
      }),
      true, // This endpoint requires only parent_portal.access.
    );
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      logger.warn("parent_child_today_unavailable", {
        status: err.status,
        student_id: studentId,
      });
      return UNKNOWN_CHILD_TODAY;
    }
    throw err;
  }
}

/**
 * Fetches the Monday-Friday meal plan for the child's school for the week
 * containing weekStart (YYYY-MM-DD). Returns 403 (meals.plan_disabled) when the
 * school does not run a meal plan; callers gate on meal_plan_enabled first.
 */
export async function getChildMealPlan(
  studentId: string,
  weekStart: string,
): Promise<MealPlanEntry[]> {
  const entries = await parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/meal-plan", {
      params: { studentId },
      query: { week_start: weekStart },
    }),
  );
  return (entries ?? []).map((entry) => ({
    ...entry,
    allergens: normalizeMealAllergens(entry.allergens),
  }));
}

export type MealParticipation = Omit<
  parentMeContract.MealParticipationResponse,
  "weekdays" | "days"
> & {
  readonly weekdays: number[];
  readonly days: parentMeContract.MealParticipationDayResponse[];
};

// The days a week change changed, and the days it left because their
// deadline had passed.
export interface MealWeekChange {
  readonly changed: string[];
  readonly locked: string[];
}

export async function getMealParticipation(
  studentId: string,
  from: string,
  to: string,
): Promise<MealParticipation> {
  const participation = await parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/meal-participation",
      {
        params: { studentId },
        query: { from, to },
      },
    ),
  );
  return {
    ...participation,
    weekdays: participation.weekdays ?? [],
    days: participation.days ?? [],
  };
}

/**
 * Replaces the child's regular days against the `version` of the regular
 * days the page read (ADR 0311): days changed since are refused with
 * `general.changed_since_read`. Answers the version of the days stored.
 */
export async function replaceMealParticipationSchedule(
  studentId: string,
  weekdays: number[],
  expectedVersion: string,
): Promise<{ effective_from: string; version: string }> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/meal-participation",
      {
        params: { studentId },
        body: { weekdays, expected_version: expectedVersion },
      },
    ),
  );
}

export async function setMealParticipationDay(
  studentId: string,
  date: string,
  participating: boolean,
): Promise<void> {
  await parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/meal-participation/{date}",
      { params: { studentId, date }, body: { participating } },
    ),
  );
}

// Registers or cancels every remaining weekday of the week containing date.
export async function setMealParticipationWeek(
  studentId: string,
  date: string,
  participating: boolean,
): Promise<MealWeekChange> {
  const change = await parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/meal-participation/weeks/{date}",
      { params: { studentId, date }, body: { participating } },
    ),
  );
  return { changed: change.changed ?? [], locked: change.locked ?? [] };
}

export async function clearMealParticipationDay(
  studentId: string,
  date: string,
): Promise<void> {
  await parentCall(
    bffJson(
      "parent",
      "DELETE /parent/me/children/{studentId}/meal-participation/{date}",
      { params: { studentId, date } },
    ),
  );
}

/**
 * Fetches the child's active sick days (today .. +2 months by default).
 * Used to show already-reported days on the child page.
 */
export async function listSickDays(
  studentId: string,
): Promise<parentMeContract.StatusDayResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/sick-note", {
      params: { studentId },
    }),
  );
}

// --- Parent <-> OGS messaging (chat model) ---
//
// One continuous conversation per child between the guardian and the OGS (no
// subject). The guardian always talks to "the OGS [Schulname]", never an
// individual staff member — the backend masks staff names accordingly.

// One message in a conversation. `sender_kind` is "guardian" for the parent's
// own messages, "staff" for replies from the OGS. For staff messages
// `sender_name` is the "OGS [Schulname]" label.
// The message view is shared with the staff client; see ChatMessage. An own
// message that answers a group thread (#4784) names it in group_thread_id and
// group_thread_title; only the guardian and the OGS see the answer.
export type ParentMessage = ChatMessage;

// One row on the messages landing page: a child's conversation, with the
// guardian's unread (staff-sent) count and last-activity metadata. The
// structured fields of the last message let the localized portal preview a
// request title / decision / withdrawal from fields instead of the German
// last_message_body (see parentThreadPreviewI18nDescriptor). Empty for plain
// messages, where last_message_body is the language-neutral written text.
export type ThreadSummary = Omit<
  parentMeContract.ThreadSummaryResponse,
  "last_sender_kind" | "last_message_kind" | "audience" | "readers"
> & {
  readonly last_sender_kind?: "guardian" | "staff";
  readonly last_message_kind?: MessageKind;
  /** Absent means the team conversation. */
  readonly audience?: MessageAudience;
  readonly readers?: ParentReaders;
};

/**
 * Who can read a conversation (#5200), as the backend reports it. `guardian`
 * is the signed-in parent (absent on list rows); other guardians of the child
 * do not read along. `school.names` carries the leadership's short names
 * („Swantje M.“) on an opened leadership conversation.
 */
interface ParentReaders {
  readonly guardian?: { readonly name: string };
  readonly school: SchoolReaders;
}

/** What a guardian can do or did for one child in an Einverständnis. */
export type ParentDeclarationAction = "agreed" | "declined" | "revoked";

/** Per-child state of an Einverständnis for its current version. */
export const PARENT_DECLARATION_STATES = [
  "open",
  "partial",
  "agreed",
  "declined",
  "revoked",
  "no_signer",
  "expired",
] as const;
export type ParentDeclarationState = (typeof PARENT_DECLARATION_STATES)[number];

// A child's full conversation (messages oldest-first). `thread_id` is empty
// when the guardian has not written about this child yet.
export type ThreadView = Omit<
  parentMeContract.ThreadViewResponse,
  "audience" | "readers" | "leadership_option" | "messages"
> & {
  readonly audience?: MessageAudience;
  readonly readers?: ParentReaders;
  /**
   * Whether the parent may start a conversation with the leadership only:
   * false while the school has it switched off or has no leadership.
   */
  readonly leadership_option?: Omit<
    parentMeContract.LeadershipOptionResponse,
    "names" | "unnamed_count"
  > & {
    readonly names: readonly string[];
    readonly unnamed_count?: number;
  };
  readonly messages: ParentMessage[];
};

/**
 * Lists the guardian's conversations: per child the team one and, once
 * begun, the one with the leadership only (#5200). Every link and reply
 * carries the row's audience.
 */
export async function listMessageThreads(): Promise<ThreadSummary[]> {
  const threads = await parentCall(
    bffJson("parent", "GET /parent/me/messages"),
  );
  return (threads ?? []).map(threadSummaryOf);
}

/** A holiday period a parent can register children for (#6671). */
export type HolidayOffer = Omit<
  parentMeContract.HolidayRegistrationOfferResponse,
  "registration_opens_on" | "registration_closes_on"
> & {
  readonly registration_opens_on: string;
  readonly registration_closes_on: string;
};

/**
 * The published holiday periods of the Träger of the account's children
 * whose registration has not closed. Empty without a child the account may
 * register.
 */
export async function listHolidayOffers(): Promise<HolidayOffer[]> {
  const offers = await parentCall(
    bffJson("parent", "GET /parent/me/holiday-registrations"),
  );
  // Go always sets the registration window of an offer.
  return (offers ?? []).map((offer) => ({
    ...offer,
    registration_opens_on: requiredDay(
      offer.registration_opens_on,
      "holiday_offer.registration_opens_on",
    ),
    registration_closes_on: requiredDay(
      offer.registration_closes_on,
      "holiday_offer.registration_closes_on",
    ),
  }));
}

/**
 * The holiday registrations linked to the account (#6673, ADR 0216), newest
 * first. Empty for an account without one.
 */
export async function listHolidayRegistrationEntries(): Promise<
  HolidayRegistrationEntry[]
> {
  const body = await parentCall(
    bffJson("parent", "GET /parent/me/holiday-registration-entries"),
  );
  return holidayRegistrationEntriesFromBackend(body);
}

/**
 * Counts the conversations with unread staff-side activity for the badge:
 * exactly the rows the inbox shows (#5200), team and leadership ones per
 * child plus the group threads.
 */
export async function fetchMessagesUnreadCount(): Promise<number> {
  const [threads, groups] = await Promise.all([
    listMessageThreads(),
    listGroupThreads(),
  ]);
  return [...threads, ...groups].filter((thread) => thread.unread > 0).length;
}

/**
 * The guardian's parent-news feed across all their (news-enabled) children's
 * schools, newest-published first. Visibility + audience are enforced
 * server-side from the JWT account.
 */
export async function listAnnouncements(): Promise<
  parentMeContract.AnnouncementResponse[]
> {
  return parentCall(bffJson("parent", "GET /parent/me/news"));
}

/**
 * Number of parent letters that still need attention. This includes unread
 * letters, pending read confirmations, and unanswered open surveys.
 */
export async function fetchAnnouncementsUnreadCount(): Promise<number> {
  const result = await parentCall(
    bffJson("parent", "GET /parent/me/news/unread-count"),
  );
  return result.unread_count ?? 0;
}

/**
 * Attachments of one announcement. Loaded when the guardian opens the message,
 * not with the feed: the file only matters once the message is being read, and
 * the audience check runs per announcement.
 *
 * Returns an empty list for an announcement outside the guardian's audience —
 * the backend answers 404 there, which is the same answer it gives for an
 * announcement that does not exist.
 */
export async function listAnnouncementAttachments(
  announcementId: string,
): Promise<sharedContract.AnnouncementAttachmentResponse[]> {
  const result = await parentCall(
    bffJson("parent", "GET /parent-news-attachments/{announcementId}", {
      params: { announcementId },
    }),
  );
  return result.attachments ?? [];
}

/** Address a guardian downloads an attachment from. */
export function announcementAttachmentDownloadUrl(
  announcementId: string,
  attachmentId: string,
): string {
  return bffFileHref(
    "parent",
    "GET /parent-news-attachments/{announcementId}/{attachmentId}/download",
    { params: { announcementId, attachmentId } },
  );
}

/**
 * Marks an announcement read for this guardian (idempotent). `publishedAt` is
 * the version the client loaded; the backend rejects the request (409) if the
 * announcement has since been corrected/republished, so a stale tab cannot
 * record a read for wording the guardian never saw.
 */
export async function markAnnouncementRead(
  announcementId: string,
  publishedAt: string,
): Promise<void> {
  await parentCall(
    bffJson("parent", "POST /parent/me/news/{announcementId}/read", {
      params: { announcementId },
      body: { published_at: publishedAt },
    }),
  );
}

/**
 * Records an explicit "gelesen und bestätigt" for an announcement. `publishedAt`
 * is verified against the live announcement (see markAnnouncementRead) so a
 * confirmation is never counted against since-corrected wording.
 */
export async function acknowledgeAnnouncement(
  announcementId: string,
  publishedAt: string,
): Promise<void> {
  await parentCall(
    bffJson("parent", "POST /parent/me/news/{announcementId}/acknowledge", {
      params: { announcementId },
      body: { published_at: publishedAt },
    }),
  );
}

/**
 * Records the guardian's answer to an Umfrage for ONE child (#1371).
 * `optionIds` replaces whatever was selected for that child; an empty array
 * withdraws the answer. Same `publishedAt` version guard as the read/ack calls,
 * plus the server-side answer deadline.
 */
export async function respondToAnnouncement(
  announcementId: string,
  studentId: string,
  optionIds: readonly string[],
  publishedAt: string,
): Promise<void> {
  await parentCall(
    bffJson("parent", "POST /parent/me/news/{announcementId}/respond", {
      params: { announcementId },
      body: {
        student_id: studentId,
        option_ids: [...optionIds],
        published_at: publishedAt,
      },
    }),
  );
}

/** The questionnaire of an Umfrage in the feed (#4781). */
export async function fetchParentSurveyForm(
  announcementId: string,
): Promise<SurveyForm> {
  const form = await parentCall(
    bffJson("parent", "GET /parent/me/news/{announcementId}/survey", {
      params: { announcementId },
    }),
  );
  return {
    ...form,
    survey: {
      ...form.survey,
      // A question kind this build does not know cannot be answered here.
      questions: (form.survey.questions ?? []).flatMap((question) => {
        const kind = knownEnum(SURVEY_QUESTION_KINDS, question.kind);
        return kind
          ? [{ ...question, kind, options: question.options ?? [] }]
          : [];
      }),
    },
  };
}

const SURVEY_QUESTION_KINDS = [
  "single",
  "multiple",
  "scale",
  "text",
] as const satisfies readonly SurveyQuestionKind[];

/**
 * Submits the answers to an Umfrage once per parent account (#4781). The
 * answers travel only in the body, never in the address.
 */
export async function submitParentSurveyAnswers(
  announcementId: string,
  body: SurveyAnswersRequest,
): Promise<void> {
  await parentCall(
    bffJson("parent", "POST /parent/me/news/{announcementId}/survey", {
      params: { announcementId },
      body,
    }),
  );
}

/**
 * Submits one action of an Einverständnis for ONE child (#3430). `versionId` is
 * the version the guardian read; the backend answers 409
 * `care.declaration_version_changed` when the school has published a new one.
 * `password` is sent only when the Einverständnis asks for it. Password errors
 * are 403 on purpose, so they never trigger the 401 logout.
 */
export async function submitDeclaration(
  announcementId: string,
  input: {
    readonly studentId: string;
    readonly action: ParentDeclarationAction;
    readonly versionId: string;
    readonly password?: string;
    /** Sent only when agreeing to an Einverständnis that asks for it. */
    readonly signature?: SignatureValue;
  },
): Promise<{
  submission: parentMeContract.parentDeclarationSubmissionResponse;
  created: boolean;
}> {
  return parentCall(
    bffJson("parent", "POST /parent/me/news/{announcementId}/declaration", {
      params: { announcementId },
      body: {
        student_id: input.studentId,
        action: input.action,
        version_id: input.versionId,
        ...(input.password === undefined ? {} : { password: input.password }),
        ...(input.signature === undefined
          ? {}
          : { signature: signatureRequestBody(input.signature) }),
      },
    }),
  );
}

/**
 * Downloads the proof as the school's PDF (#3430), under the file name the
 * backend chose. Fetched first rather than opened as a link, so a failure
 * stays on the page as a message; a 401 still leads to the login.
 */
export async function downloadDeclarationProofPdf(
  announcementId: string,
  studentId: string,
): Promise<void> {
  const response = await parentCall(
    bffFile(
      "parent",
      "GET /parent/me/news/{announcementId}/declaration/proof/pdf",
      { params: { announcementId }, query: { student_id: studentId } },
    ),
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? "nachweis-erklaerung.pdf",
  );
}

/**
 * Proof data of this account's Einverständnis for one child. 404 when the account
 * has no access or has not submitted anything for the child yet.
 */
export async function fetchDeclarationProof(
  announcementId: string,
  studentId: string,
): Promise<parentMeContract.declarationProofResponse> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/news/{announcementId}/declaration/proof",
      {
        params: { announcementId },
        query: { student_id: studentId },
      },
    ),
  );
}

/** Address for an attachment frozen in this child's own declaration proof. */
export function declarationProofAttachmentDownloadUrl(
  announcementId: string,
  studentId: string,
  attachmentId: string,
): string {
  return bffFileHref(
    "parent",
    "GET /parent-news-attachments/{announcementId}/{attachmentId}/download",
    {
      params: { announcementId, attachmentId },
      query: { student_id: studentId },
    },
  );
}

/** Portal page that shows the proof for one child. */
export function declarationProofPath(
  announcementId: string,
  studentId: string,
): string {
  return `/parents/news/${encodeURIComponent(announcementId)}/nachweis?student=${encodeURIComponent(studentId)}`;
}

/**
 * Fetches the guardian's conversation about one child (oldest-first), creating
 * nothing — an empty conversation comes back with an empty `thread_id`. Reading
 * marks it read server-side.
 */
export async function getChildConversation(
  studentId: string,
  audience: MessageAudience = "team",
): Promise<ThreadView> {
  return threadViewOf(
    await parentCall(
      bffJson("parent", "GET /parent/me/messages/children/{studentId}", {
        params: { studentId },
        query: { audience: audience === "leadership" ? audience : undefined },
      }),
    ),
  );
}

/**
 * The guardian's conversations about one child (team and, if begun,
 * leadership), without marking them read.
 */
export async function listChildThreads(
  studentId: string,
): Promise<ThreadSummary[]> {
  const threads = await parentCall(
    bffJson("parent", "GET /parent/me/messages/children/{studentId}/threads", {
      params: { studentId },
    }),
  );
  return (threads ?? []).map(threadSummaryOf);
}

/**
 * Appends a guardian message to the child's conversation (created on the first
 * message) and returns the full updated conversation.
 */
export async function postChildMessage(
  studentId: string,
  body: string,
  groupThreadId?: string,
  audience: MessageAudience = "team",
  clientMessageId?: string,
  attachmentIds?: readonly string[],
): Promise<ThreadView> {
  // An answer to a group thread always goes to the team conversation.
  const view = await parentCall(
    bffJson("parent", "POST /parent/me/messages/children/{studentId}", {
      params: { studentId },
      // JSON drops undefined keys: a team message sends only its body.
      body: {
        body,
        client_message_id: clientMessageId,
        group_thread_id: groupThreadId,
        attachment_ids: attachmentIds?.length ? [...attachmentIds] : undefined,
        audience: groupThreadId || audience === "team" ? undefined : audience,
      },
    }),
  );
  return threadViewOf(view);
}

// Gruppennachrichten (#4784): the OGS writes to a group, class or AG. The
// guardian sees only what reached them, for their own children; an answer
// goes into the child's conversation with the OGS.

/** One row of the guardian's group thread list. */
export type GroupThreadSummary = Omit<
  parentMeContract.GroupThreadSummaryResponse,
  "children" | "readers"
> & {
  /** The guardian's own children the thread reached; never other families. */
  readonly children: readonly parentMeContract.GroupThreadChildResponse[];
  /** Who reads the guardian's answer: always the whole OGS team. */
  readonly readers?: ParentReaders;
};

/**
 * An opened group thread. Its messages come from the OGS, with their photos
 * and files (#6685).
 */
export type GroupThreadView = GroupThreadSummary & {
  readonly messages: readonly parentMeContract.GroupMessageResponse[];
};

// The messaging answers type every enum as plain strings (#7808). These
// readers map them once into the views the conversation UI shares with the
// staff portal.
const AUDIENCES = [
  "team",
  "leadership",
] as const satisfies readonly MessageAudience[];
const READER_KINDS = [
  "all_staff",
  "leadership",
] as const satisfies readonly SchoolReaders["kind"][];

function readersOf(raw: parentMeContract.ParentReadersResponse): ParentReaders {
  return {
    ...(raw.guardian ? { guardian: raw.guardian } : {}),
    school: {
      kind: knownEnum(READER_KINDS, raw.school.kind) ?? "all_staff",
      names: raw.school.names ?? [],
      unnamed_count: raw.school.unnamed_count,
    },
  };
}

function parentMessageOf(
  raw: parentMeContract.ParentMessageResponse,
): ParentMessage | null {
  const fields = chatMessageFieldsOf(raw);
  return fields ? { ...raw, ...fields } : null;
}

function threadSummaryOf(
  raw: parentMeContract.ThreadSummaryResponse,
): ThreadSummary {
  const senderKind = knownSenderKind(raw.last_sender_kind);
  return {
    ...raw,
    last_sender_kind: senderKind === "system" ? undefined : senderKind,
    last_message_kind: knownMessageKind(raw.last_message_kind),
    audience: knownEnum(AUDIENCES, raw.audience),
    readers: readersOf(raw.readers),
  };
}

function threadViewOf(raw: parentMeContract.ThreadViewResponse): ThreadView {
  return {
    ...raw,
    audience: knownEnum(AUDIENCES, raw.audience),
    readers: readersOf(raw.readers),
    leadership_option: {
      ...raw.leadership_option,
      names: raw.leadership_option.names ?? [],
    },
    messages: (raw.messages ?? []).flatMap((message) => {
      const mapped = parentMessageOf(message);
      return mapped ? [mapped] : [];
    }),
  };
}

function groupThreadSummaryOf(
  raw: parentMeContract.GroupThreadSummaryResponse,
): GroupThreadSummary {
  return {
    ...raw,
    children: raw.children ?? [],
    readers: readersOf(raw.readers),
  };
}

function groupThreadViewOf(
  raw: parentMeContract.GroupThreadViewResponse,
): GroupThreadView {
  return {
    ...groupThreadSummaryOf(raw),
    messages: raw.messages ?? [],
  };
}

/** Lists the group threads that reached the guardian, newest first. */
export async function listGroupThreads(): Promise<GroupThreadSummary[]> {
  const threads = await parentCall(
    bffJson("parent", "GET /parent/me/messages/group-threads"),
  );
  return (threads ?? []).map(groupThreadSummaryOf);
}

/** Opens one group thread. Reading marks it read server-side. */
export async function getGroupThread(
  groupThreadId: string,
): Promise<GroupThreadView> {
  return groupThreadViewOf(
    await parentCall(
      bffJson(
        "parent",
        "GET /parent/me/messages/group-threads/{groupThreadId}",
        { params: { groupThreadId } },
      ),
    ),
  );
}

/**
 * Sets a one-day pickup override for the child. Arrival times remain under OGS
 * control. The backend verifies guardianship, the feature gate, and refuses to
 * overwrite a staff-set pickup exception.
 */
export async function submitCareException(
  studentId: string,
  params: {
    date: string;
    /** Leer: die Abholzeit des Tages bleibt (#3945). */
    pickupTime: string;
    /** Leer: die Abholart des Tages bleibt (#3945). */
    departureMode?: DayDepartureMode | "";
    reason: string;
    recipientGuardianProfileIds?: string[];
    /** Kontaktperson, die das Kind an diesem Tag abholt (#4780). */
    pickupPersonGuardianProfileId?: string;
    /** Nötig für eine Abholperson oder den Heimweg allein (#4780). */
    signature?: SignatureValue | null;
    /** Der vom Server geladene Wortlaut neben der Unterschrift (#4780). */
    signatureStatement?: string;
  },
): Promise<parentMeContract.PickupChangeRequestResponse> {
  return parentCall(
    bffJson("parent", "POST /parent/me/children/{studentId}/care-exception", {
      params: { studentId },
      body: {
        date: params.date,
        pickup_time: params.pickupTime || undefined,
        departure_mode: params.departureMode || undefined,
        reason: params.reason,
        recipient_guardian_profile_ids:
          params.recipientGuardianProfileIds ?? [],
        pickup_person_guardian_profile_id:
          params.pickupPersonGuardianProfileId || undefined,
        ...(params.signature
          ? {
              signature: signatureRequestBody(
                params.signature,
                params.signatureStatement,
              ),
            }
          : {}),
      },
    }),
  );
}

/** Changes the guardian's own still-pending pickup-time request. */
export async function updatePickupChangeRequest(
  studentId: string,
  requestId: string,
  input: {
    date: string;
    pickupTime: string;
    departureMode?: DayDepartureMode | "";
    reason: string;
    expectedVersion: string;
    pickupPersonGuardianProfileId?: string;
    signature?: SignatureValue | null;
    signatureStatement?: string;
  },
): Promise<parentMeContract.PickupChangeRequestResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/pickup-change-requests/{requestId}",
      {
        params: { studentId, requestId },
        body: {
          date: input.date,
          pickup_time: input.pickupTime,
          departure_mode: input.departureMode ?? "",
          reason: input.reason,
          expected_version: input.expectedVersion,
          pickup_person_guardian_profile_id:
            input.pickupPersonGuardianProfileId ?? "",
          ...(input.signature
            ? {
                signature: signatureRequestBody(
                  input.signature,
                  input.signatureStatement,
                ),
              }
            : {}),
        },
      },
    ),
  );
}

/**
 * Lädt den Nachweis einer unterschriebenen Anfrage als PDF der Schule
 * (#4780). Nur die Person, die unterschrieben hat, bekommt ihn.
 */
export async function downloadPickupRequestProofPdf(
  studentId: string,
  requestId: string,
): Promise<void> {
  const response = await parentCall(
    bffFile(
      "parent",
      "GET /parent/me/children/{studentId}/pickup-requests/{requestId}/proof/pdf",
      { params: { studentId, requestId } },
    ),
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? "nachweis-abholerlaubnis.pdf",
  );
}

/** Die Abholerlaubnis-Anfragen des Kindes, die dieses Konto sieht (#4780). */
export async function listPickupPermissionRequests(
  studentId: string,
): Promise<parentMeContract.pickupPermissionRequestResponse[]> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/pickup-permission-requests",
      { params: { studentId } },
    ),
  );
}

export interface PickupSignatureStatementInput {
  readonly kind: "pickup_permission" | "day_pickup" | "weekly_alone";
  readonly personName?: string;
  readonly weekdays?: readonly number[];
  readonly date?: string;
  readonly departureMode?: DayDepartureMode | "";
}

/** Loads the canonical declaration before the parent draws a signature. */
export async function getPickupSignatureStatement(
  studentId: string,
  input: PickupSignatureStatementInput,
): Promise<string> {
  const response = await parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/pickup-signature-statement",
      {
        params: { studentId },
        body: {
          kind: input.kind,
          person_name: input.personName,
          weekdays: input.weekdays ? [...input.weekdays] : undefined,
          date: input.date,
          departure_mode: input.departureMode,
        },
      },
    ),
  );
  return response.statement;
}

/**
 * Bittet die OGS, eine Kontaktperson an allen Tagen oder an Wochentagen
 * abholen zu lassen, unterschrieben (#4780).
 */
export async function submitPickupPermissionRequest(
  studentId: string,
  guardianProfileId: string,
  input: {
    weekdays: readonly number[];
    signature: SignatureValue;
    statement: string;
    reason?: string;
    relationship?: parentMeContract.updateGuardianRelationshipRequest;
  },
): Promise<parentMeContract.pickupPermissionRequestResponse> {
  return parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/guardians/{guardianProfileId}/pickup-permission-requests",
      {
        params: { studentId, guardianProfileId },
        body: {
          weekdays: [...input.weekdays],
          reason: input.reason ?? "",
          signature: signatureRequestBody(input.signature, input.statement),
          relationship: input.relationship,
        },
      },
    ),
  );
}

export async function listPickupChangeRequests(
  studentId: string,
): Promise<parentMeContract.PickupChangeRequestResponse[]> {
  return parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/pickup-change-requests",
      { params: { studentId } },
    ),
  );
}

// --- Related accounts (who has parents-app access to the child) ---

/** Lists guardians linked to the child, with portal-access status. */
export async function listRelatedAccounts(
  studentId: string,
): Promise<parentMeContract.relatedAccountResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/related-accounts", {
      params: { studentId },
    }),
  );
}

// --- Guardian contact + pickup info (#1667) ---

/** Lists the child's guardians with contact + pickup detail and edit caps. */
export async function listChildGuardians(
  studentId: string,
): Promise<parentMeContract.childGuardianResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/guardians", {
      params: { studentId },
    }),
  );
}

/** Adds an accountless contact to the child. */
export async function createGuardianContact(
  studentId: string,
  payload: parentMeContract.createGuardianContactRequest,
): Promise<parentMeContract.childGuardianResponse> {
  return parentCall(
    bffJson("parent", "POST /parent/me/children/{studentId}/guardians", {
      params: { studentId },
      body: payload,
    }),
  );
}

/** Updates a contact-only guardian's contact data (or the caller's own). */
export async function updateGuardianContact(
  studentId: string,
  guardianProfileId: string,
  payload: parentMeContract.updateGuardianContactRequest,
): Promise<parentMeContract.childGuardianResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/guardians/{guardianProfileId}/contact",
      { params: { studentId, guardianProfileId }, body: payload },
    ),
  );
}

/** Updates the per-child pickup/relationship fields of a guardian. */
export async function updateGuardianRelationship(
  studentId: string,
  guardianProfileId: string,
  payload: parentMeContract.updateGuardianRelationshipRequest,
): Promise<parentMeContract.childGuardianResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/guardians/{guardianProfileId}/pickup",
      { params: { studentId, guardianProfileId }, body: payload },
    ),
  );
}

/** Invites a further guardian to the child by email. */
export async function inviteRelatedAccount(
  studentId: string,
  email: string,
  options?: {
    firstName?: string;
    lastName?: string;
    confirmRoleUpgrade?: boolean;
  },
): Promise<parentMeContract.inviteRelatedAccountResponse> {
  return parentCall(
    bffJson("parent", "POST /parent/me/children/{studentId}/related-accounts", {
      params: { studentId },
      body: {
        email,
        first_name: options?.firstName ?? "",
        last_name: options?.lastName ?? "",
        // Only sent when confirming an upgrade; a plain invite keeps the
        // historical three-field body.
        ...(options?.confirmRoleUpgrade ? { confirm_role_upgrade: true } : {}),
      },
    }),
  );
}

/**
 * Fetches the child's pickup/arrival overrides (today .. +2 months by default),
 * staff- and parent-set alike, so the modal can show what is already in place.
 */
/**
 * Without a range the server answers today to two months ahead; the absence
 * dialog passes its chosen days, which may lie further out (#5698).
 */
export async function listCareExceptions(
  studentId: string,
  range?: { readonly from: string; readonly to: string },
): Promise<parentMeContract.CareExceptionResponse[]> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/care-exception", {
      params: { studentId },
      query: { from: range?.from, to: range?.to },
    }),
  );
}

/** Removes the parent-set override for a single date (YYYY-MM-DD). */
export async function deleteCareException(
  studentId: string,
  date: string,
): Promise<void> {
  await parentCall(
    bffJson("parent", "DELETE /parent/me/children/{studentId}/care-exception", {
      params: { studentId },
      query: { date },
    }),
  );
}

/**
 * Fetches the child's standard weekly care plan (Mon-Fr), the guardian's own
 * still-open change request (if any), and whether a new request may be
 * submitted. Powers the care-schedule section on the Stammdaten page.
 */
export async function getChildCareSchedule(
  studentId: string,
): Promise<parentMeContract.CareScheduleResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/care-schedule", {
      params: { studentId },
    }),
  );
}

export type CareScheduleRequestInput = {
  readonly weekdays: ReadonlyArray<
    parentMeContract.WeekdayChange & { readonly weekday: number }
  >;
};

/**
 * Submits a permanent change request for the child's standard weekly plan.
 * A weekday the child walks home alone needs a signature (#4780).
 */
export async function submitCareScheduleRequest(
  studentId: string,
  payload: CareScheduleRequestInput,
  signature?: SignatureValue | null,
  signatureStatement?: string,
): Promise<parentMeContract.CareScheduleResponse> {
  return parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/care-schedule/requests",
      {
        params: { studentId },
        body: {
          payload: { weekdays: [...payload.weekdays] },
          ...(signature
            ? { signature: signatureRequestBody(signature, signatureStatement) }
            : {}),
        },
      },
    ),
  );
}

// --- Booked care offerings (#1665, #2303) ---

/** Why the change button is unavailable. Stable identifiers from the backend. */
export type OfferingChangesDisabledReason =
  | "no_enrollment"
  | "no_permission"
  | "school_disabled"
  | "period_over"
  | "no_time_remaining";

/** One selectable offering in the change-request modal. */
export type OfferingCatalogItem = Omit<
  parentMeContract.OfferingCatalogItemResponse,
  "available_days"
> & { readonly available_days: string[] };

/** The selectable catalog plus the allowed effective-date window. */
export type OfferingCatalog = Omit<
  parentMeContract.OfferingCatalogResponse,
  "items"
> & { readonly items: OfferingCatalogItem[] };

/** Returns the care offerings the child is booked into. */
export async function getChildCareOfferings(
  studentId: string,
): Promise<parentMeContract.CareOfferingsResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/care-offerings", {
      params: { studentId },
    }),
  );
}

/** Returns the offerings the guardian may pick from, prefilled. */
export async function getChildOfferingCatalog(
  studentId: string,
  effectiveFrom?: string,
): Promise<OfferingCatalog> {
  const catalog = await parentCall(
    bffJson(
      "parent",
      "GET /parent/me/children/{studentId}/care-offerings/catalog",
      { params: { studentId }, query: { effective_from: effectiveFrom } },
    ),
  );
  return {
    ...catalog,
    items: (catalog.items ?? []).map((item) => ({
      ...item,
      available_days: item.available_days ?? [],
    })),
  };
}

/**
 * Submits a post-enrollment offering change. The selection is the COMPLETE
 * desired booking, not a delta: staff decide one coherent booking, and the
 * backend re-validates it against capacity and the phase rules on approval.
 */
export async function submitOfferingChangeRequest(
  studentId: string,
  input: {
    offerings: parentMeContract.OfferingSelectionBody[];
    effective_from: string;
    note?: string;
    complete_withdrawal_confirmed?: boolean;
  },
  recipientGuardianProfileIds: string[] = [],
): Promise<parentMeContract.CareOfferingsResponse> {
  return parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/care-offerings/requests",
      {
        params: { studentId },
        body: {
          ...input,
          recipient_guardian_profile_ids: recipientGuardianProfileIds,
        },
      },
    ),
  );
}

/**
 * Changes the guardian's own still-open offering change request. The body is
 * the same shape as the create call (`offerings`, not `selections`) so the
 * catalog screen can feed both without translating between two field names.
 */
export async function updateOfferingChangeRequest(
  studentId: string,
  requestId: string,
  input: {
    offerings: parentMeContract.OfferingSelectionBody[];
    effective_from: string;
    note?: string;
    complete_withdrawal_confirmed?: boolean;
    expectedVersion: string;
  },
): Promise<parentMeContract.CareOfferingsResponse> {
  const { expectedVersion, ...body } = input;
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/care-offerings/requests/{requestId}",
      {
        params: { studentId, requestId },
        body: { ...body, expected_version: expectedVersion },
      },
    ),
  );
}

/** Returns the school's courses with this child's state. */
export async function getChildCourses(
  studentId: string,
): Promise<parentMeContract.CoursesResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/courses", {
      params: { studentId },
    }),
  );
}

/** Asks the OGS for one course. It takes effect only after their approval. */
export async function requestChildCourse(
  studentId: string,
  courseId: string,
  note?: string,
): Promise<parentMeContract.CoursesResponse> {
  return parentCall(
    bffJson("parent", "POST /parent/me/children/{studentId}/courses/requests", {
      params: { studentId },
      body: { course_id: courseId, note: note ?? "" },
    }),
  );
}

/** Takes back the guardian's own open course request. */
export async function withdrawChildCourseRequest(
  studentId: string,
  requestId: string,
): Promise<parentMeContract.CoursesResponse> {
  return parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/courses/requests/{requestId}/withdraw",
      { params: { studentId, requestId } },
    ),
  );
}

/** Fetches the child's structured Stammdaten view (guardian's own data included). */
export async function getChildMasterData(
  studentId: string,
): Promise<parentMeContract.MasterDataResponse> {
  return parentCall(
    bffJson("parent", "GET /parent/me/children/{studentId}/master-data", {
      params: { studentId },
    }),
  );
}

/**
 * Applies a Track A direct edit to a single field and returns the refreshed
 * view. `value` is JSON (a string for every Track A field today).
 */
export async function updateMasterDataField(
  studentId: string,
  target: string,
  field: string,
  value: unknown,
): Promise<parentMeContract.MasterDataResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PATCH /parent/me/children/{studentId}/master-data/{target}/{field}",
      { params: { studentId, target, field }, body: { value } },
    ),
  );
}

/** One proposed Track B change. value is JSON (string or departure-modes object). */
export interface MasterDataChangeInput {
  readonly target: string;
  readonly field_key: string;
  readonly value: unknown;
}

/** Submits Track B change requests (name, birthday, class, permanent Gehzeit) for approval. */
export async function submitMasterDataRequest(
  studentId: string,
  changes: MasterDataChangeInput[],
  recipientGuardianProfileIds: string[] = [],
): Promise<parentMeContract.MasterDataChangeResponse[]> {
  return parentCall(
    bffJson(
      "parent",
      "POST /parent/me/children/{studentId}/master-data/requests",
      {
        params: { studentId },
        body: {
          changes,
          recipient_guardian_profile_ids: recipientGuardianProfileIds,
        },
      },
    ),
  );
}

/** Changes the guardian's own still-pending Stammdaten change request. */
export async function updateMasterDataRequest(
  studentId: string,
  requestId: string,
  input: { newValue: unknown; expectedVersion: string },
): Promise<parentMeContract.MasterDataChangeResponse> {
  return parentCall(
    bffJson(
      "parent",
      "PUT /parent/me/children/{studentId}/master-data/requests/{requestId}",
      {
        params: { studentId, requestId },
        body: {
          new_value: input.newValue,
          expected_version: input.expectedVersion,
        },
      },
    ),
  );
}

/** Removes another account's access to the child (not the primary guardian). */
export async function removeRelatedAccount(
  studentId: string,
  guardianProfileId: string,
): Promise<void> {
  await parentCall(
    bffJson(
      "parent",
      "DELETE /parent/me/children/{studentId}/related-accounts/{guardianProfileId}",
      { params: { studentId, guardianProfileId } },
    ),
  );
}

// ── Dokumente (#4671) ──────────────────────────────────────────────────────

/**
 * One document a Träger sent to this account's address: today the
 * confirmation letter of a holiday registration, which is its invoice.
 * Mirrors backend BillingDocumentResponse; dates are "YYYY-MM-DD", sent_at
 * an instant.
 */
export type ParentDocument = Omit<
  parentMeContract.BillingDocumentResponse,
  "service_from"
> & { readonly service_from: string };

/**
 * The documents the Träger of the account's schools sent to the family:
 * the letters and the care contracts (#4678), newest first. 403 when no
 * relationship of the account grants them.
 */
export interface ParentDocumentInbox {
  readonly documents: ParentDocument[];
  /** Documents a Träger released for the parents (#4692). */
  readonly shared: parentMeContract.SharedDocumentResponse[];
  /** `several` when more than one source failed: no single one is named. */
  readonly failedSource: "letters" | "contracts" | "shared" | "several" | null;
  readonly error: unknown;
}

export async function listMyDocuments(): Promise<ParentDocumentInbox> {
  const [letters, contracts, shared] = await Promise.allSettled([
    parentCall(bffJson("parent", "GET /parent/me/documents")),
    parentCall(bffJson("parent", "GET /parent/me/documents/contracts")),
    parentCall(bffJson("parent", "GET /parent/me/documents/shared")),
  ]);
  if (
    letters.status === "rejected" &&
    contracts.status === "rejected" &&
    shared.status === "rejected"
  ) {
    throw letters.reason;
  }
  const documents = [
    ...(letters.status === "fulfilled" ? (letters.value ?? []) : []),
    ...(contracts.status === "fulfilled" ? (contracts.value ?? []) : []),
  ]
    // Go always sets the first day a document covers.
    .map((document) => ({
      ...document,
      service_from: requiredDay(document.service_from, "document.service_from"),
    }))
    .sort(
      (a, b) =>
        Date.parse(b.sent_at) - Date.parse(a.sent_at) ||
        // Newer ID first; decimal strings compare exactly by length, then text.
        b.id.length - a.id.length ||
        (b.id > a.id ? 1 : b.id < a.id ? -1 : 0),
    );
  const failed = [
    ["letters", letters],
    ["contracts", contracts],
    ["shared", shared],
  ] as const;
  const failures = failed.filter(([, result]) => result.status === "rejected");
  const firstFailure = failures[0];
  return {
    documents,
    shared: shared.status === "fulfilled" ? (shared.value ?? []) : [],
    failedSource:
      failures.length > 1 ? "several" : firstFailure ? firstFailure[0] : null,
    error:
      firstFailure && firstFailure[1].status === "rejected"
        ? firstFailure[1].reason
        : null,
  };
}

/**
 * Downloads one document a Träger released for the parents, under the file
 * name the backend chose. The backend records the opening.
 */
export async function downloadMySharedDocument(
  document: Pick<
    parentMeContract.SharedDocumentResponse,
    "id" | "organization_id" | "file_name"
  >,
): Promise<void> {
  const response = await parentCall(
    bffFile(
      "parent",
      "GET /parent/me/documents/{organizationId}/shared/{documentId}/file",
      {
        params: {
          organizationId: document.organization_id,
          documentId: document.id,
        },
      },
    ),
  );
  const blob = await response.blob();
  downloadBlob(blob, filenameFromDisposition(response) ?? document.file_name);
}

/**
 * Downloads one document as the stored PDF, under the file name the backend
 * chose. Fetched first rather than opened as a link, so a failure stays on
 * the page as a message; a 401 still leads to the login.
 */
export async function downloadMyDocument(
  document: Pick<ParentDocument, "id" | "organization_id" | "number" | "kind">,
): Promise<void> {
  const response = await parentCall(
    document.kind === "care_contract"
      ? bffFile(
          "parent",
          "GET /parent/me/documents/{organizationId}/contracts/{contractId}/pdf",
          {
            params: {
              organizationId: document.organization_id,
              contractId: document.id,
            },
          },
        )
      : bffFile(
          "parent",
          "GET /parent/me/documents/{organizationId}/{documentId}/pdf",
          {
            params: {
              organizationId: document.organization_id,
              documentId: document.id,
            },
          },
        ),
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `dokument-${document.number}.pdf`,
  );
}

// ── Kündigung und Widerruf (#4682) ─────────────────────────────────────────

/**
 * What the parents can declare today on a care contract sent to them, or
 * the declaration made. 403 without the relationship right to bind the
 * family (parent_portal.enrollment.submit), 404 for a contract outside the
 * inbox.
 */
export async function fetchMyContractNoticeOptions(
  organizationId: string,
  contractId: string,
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await parentCall(
      bffJson(
        "parent",
        "GET /parent/me/documents/{organizationId}/contracts/{contractId}/notice",
        { params: { organizationId, contractId } },
      ),
    ),
  );
}

/** The parents' „jetzt kündigen“ or „jetzt widerrufen“ (§ 312k BGB). */
export async function declareMyContractNotice(
  organizationId: string,
  contractId: string,
  declaration: NoticeDeclaration,
): Promise<ContractNoticeOptions> {
  return noticeOptionsFromBackend(
    await parentCall(
      bffJson(
        "parent",
        "POST /parent/me/documents/{organizationId}/contracts/{contractId}/notice",
        {
          params: { organizationId, contractId },
          body: declarationBody(declaration),
        },
      ),
    ),
  );
}
