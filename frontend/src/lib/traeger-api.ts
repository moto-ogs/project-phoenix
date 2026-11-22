import { bffFile, bffJson, bffJsonUncontracted } from "~/lib/bff-fetch";
/**
 * Client of the Träger portal ("moto träger", #4649). Talks to the BFF
 * routes under /api/traeger, which forward to the backend with the Träger
 * session. The catalog proxy decodes every answer with the contract of its
 * route (lib/contract): IDs arrive as strings.
 */

import type { ApiResponse } from "~/lib/api-envelope";
import { ApiError, apiErrorFromBody, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as sharedContract from "./contract/shared.generated";
import type * as traegerAccountsContract from "./contract/traeger-accounts.generated";
import type * as traegerHolidayPeriodsContract from "./contract/traeger-holiday-periods.generated";
import type * as traegerMasterDataContract from "./contract/traeger-master-data.generated";
import type * as traegerProfileContract from "./contract/traeger-profile.generated";
import type * as traegerSchoolsContract from "./contract/traeger-schools.generated";
import { toSettingsSchema, type SettingsSchema } from "./settings-api";
import { filenameFromDisposition } from "./file-download";
import { portalAuthPath } from "./portal-paths";
import { signInAnswer, type SignInAnswer } from "./sign-in-answer";
import type { TraegerListFormat } from "./traeger-list-export";
import { type TraegerRole, traegerRoles } from "./traeger-roles";

export interface TraegerSchool {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly subdomain: string;
  /** Empty when the school has no city on record. */
  readonly city: string;
}

/** Live figures of one school; numbers only, no names (#5686). */
export interface TraegerSchoolFigures {
  readonly childrenTotal: number;
  readonly childrenPresent: number;
  readonly childrenSick: number;
  readonly staffTotal: number;
  readonly staffPresent: number;
  /** Present children per present staff member; null without present staff. */
  readonly careRatio: number | null;
  readonly asOf: string;
}

export interface TraegerSchoolView extends TraegerSchool {
  readonly address: string;
  readonly zip: string;
  readonly phone: string;
  readonly email: string;
  readonly figures: TraegerSchoolFigures;
}

/** One school with its figures in the overview over all schools (#4674). */
export interface TraegerSchoolToday extends TraegerSchool {
  readonly figures: TraegerSchoolFigures;
}

/** Every school of the Träger with its figures and their sum (#4674). */
export interface TraegerSchoolsToday {
  readonly schools: readonly TraegerSchoolToday[];
  /** Sums of all schools; the ratio is over all present staff. */
  readonly total: TraegerSchoolFigures;
}

/** The kinds of a hint on the dashboard (#4675), in the backend's order. */
export type TraegerAlertKind = (typeof ALERT_KIND_VALUES)[number];

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const ALERT_KIND_VALUES = [
  "staff_shortage",
  "sick_children",
  "open_enrollments",
] as const;
const NO_CARE_KIND_VALUES = ["holiday", "closing_day"] as const;
const BOOKING_UNIT_VALUES = ["week", "day"] as const;
const ALLOCATION_MODE_VALUES = ["arrival", "criteria"] as const;
const PERIOD_STATUS_VALUES = ["draft", "published"] as const;
const ACCOUNT_ACTION_VALUES = [
  "invitation_created",
  "invitation_revoked",
  "invitation_accepted",
  "roles_changed",
  "member_removed",
  "name_changed",
] as const;
const ACCESS_KIND_VALUES = ["read", "change"] as const;

/** The Träger's thresholds of the dashboard hints; 0 switches one off. */
export interface TraegerAlertThresholds {
  /** More present children per present staff member marks too little staff. */
  readonly childrenPerStaff: number;
  /** At least this share of the children sick today, in percent. */
  readonly sickPercent: number;
  /** At least this many children of the online enrollment waiting. */
  readonly openEnrollments: number;
}

/** One school with the figures behind its hints and the hints that apply. */
export interface TraegerSchoolAlerts extends TraegerSchool {
  readonly figures: TraegerSchoolFigures;
  /** Children of the online enrollment waiting for a decision. */
  readonly openEnrollments: number;
  readonly alerts: readonly TraegerAlertKind[];
}

/** The hints of every school of the Träger (#4675), ordered by name. */
export interface TraegerSchoolsAlerts {
  readonly thresholds: TraegerAlertThresholds;
  readonly schools: readonly TraegerSchoolAlerts[];
  readonly asOf: string;
}

/** Reads a JSON body; null for an empty or unreadable one. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Signs in at the Träger portal. Without `organizationId` a person who
 * belongs to several Träger gets the choice back instead of tokens. Every
 * Träger session needs the second factor: the answer is the mailed code to
 * enter, or the setup of the factor (#4651).
 */
export async function traegerLogin(input: {
  readonly email: string;
  readonly password: string;
  readonly organizationId?: string;
  /** Asks for the code even on a remembered device (#6955). */
  readonly ignoreTrustedDevice?: boolean;
}): Promise<SignInAnswer> {
  const body: Record<string, unknown> = {
    email: input.email,
    password: input.password,
  };
  if (input.ignoreTrustedDevice) body.ignore_trusted_device = true;
  if (input.organizationId !== undefined) {
    body.organization_id = Number(input.organizationId);
  }
  const response = await transportFetch(portalAuthPath("traeger", "login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      data,
    );
  }

  return signInAnswer("traeger", (data as ApiResponse<unknown>).data);
}

/** The schools of the signed-in person's Träger. */
export async function fetchTraegerSchools(): Promise<TraegerSchool[]> {
  const schools = await bffJson("org", "GET /traeger/schools/");
  return (schools ?? []).map(toTraegerSchool);
}

function toTraegerSchool(
  school: traegerSchoolsContract.TraegerSchool,
): TraegerSchool {
  return {
    id: school.id,
    name: school.name,
    slug: school.slug,
    subdomain: school.subdomain,
    city: school.city,
  };
}

function toSchoolFigures(
  figures: traegerSchoolsContract.SchoolFigures,
): TraegerSchoolFigures {
  return {
    childrenTotal: figures.children_total,
    childrenPresent: figures.children_present,
    childrenSick: figures.children_sick,
    staffTotal: figures.staff_total,
    staffPresent: figures.staff_present,
    careRatio: figures.care_ratio,
    asOf: figures.as_of,
  };
}

/**
 * The hints of every school of the Träger against the Träger's thresholds
 * (#4675): numbers only, no names.
 */
export async function fetchTraegerSchoolsAlerts(): Promise<TraegerSchoolsAlerts> {
  const alerts = await bffJson("org", "GET /traeger/schools/alerts");
  return {
    thresholds: {
      childrenPerStaff: alerts.thresholds.children_per_staff,
      sickPercent: alerts.thresholds.sick_percent,
      openEnrollments: alerts.thresholds.open_enrollments,
    },
    schools: (alerts.schools ?? []).map((school) => ({
      ...toTraegerSchool(school),
      figures: toSchoolFigures(school.figures),
      openEnrollments: school.open_enrollments,
      alerts: (school.alerts ?? []).flatMap((alert) => {
        const kind = knownEnum(ALERT_KIND_VALUES, alert);
        return kind ? [kind] : [];
      }),
    })),
    asOf: alerts.as_of,
  };
}

/** One school of the Träger with its contact data and figures (#5686). */
export async function fetchTraegerSchool(
  id: string,
): Promise<TraegerSchoolView> {
  const school = await bffJson("org", "GET /traeger/schools/{id}", {
    params: { id },
  });
  return {
    ...toTraegerSchool(school),
    address: school.address,
    zip: school.zip,
    phone: school.phone,
    email: school.email,
    figures: toSchoolFigures(school.figures),
  };
}

/**
 * Starts the Absprung into a school of the Träger (#4654) and returns the
 * short-lived hand-off token the school's host redeems into its own session.
 */
export async function startTraegerSchoolSession(
  schoolId: string,
): Promise<string> {
  const data = await bffJson("org", "POST /traeger/school-sessions/", {
    body: { school_id: schoolId },
  });
  if (!data.handoff_token) {
    throw new ApiError("School session without hand-off", 502);
  }
  return data.handoff_token;
}

/** The mailed code of a step in the running Träger session (#7068). */
export interface TraegerCodeStep {
  challengeToken: string;
  maskedEmail: string;
}

/**
 * Mails a code for the person of the Träger session (#7068). A school that
 * accepts no remembered device opens once the code is redeemed.
 */
export async function startTraegerCodeStep(): Promise<TraegerCodeStep> {
  const data = await bffJson("org", "POST /traeger/auth/mfa/step-up");
  if (!data?.challenge_token) {
    throw new ApiError("Code step without challenge", 502);
  }
  return {
    challengeToken: data.challenge_token,
    maskedEmail: data.masked_email ?? "",
  };
}

/**
 * Redeems the code in the running Träger session (#7068). The BFF installs
 * the renewed session; false means the code was right but the new session
 * could not be installed, so the person signs in again.
 */
export async function verifyTraegerCodeStep(
  challengeToken: string,
  code: string,
): Promise<boolean> {
  const data = await bffJsonUncontracted<{ session_renewed: boolean }>(
    "org",
    "POST",
    "/api/traeger/auth/mfa/step-up/verify",
    { body: { challenge_token: challengeToken, code } },
  );
  return data.session_renewed;
}

// --- Ferienzeiträume (#4659) ---

/** A bookable care time of a holiday week; the price is in whole cent. */
export interface HolidayTimeModel {
  /** Absent for a time model the form adds. */
  readonly id?: string;
  readonly name: string;
  /** Wall-clock "HH:MM". */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly priceCents: number;
  /**
   * No longer offered or bookable; the days booked on it keep it (#5994).
   * Absent means not archived; a write sets it to archive for good.
   */
  readonly archived?: boolean;
  /** Bookings name it, so it cannot be removed, only archived. Read only. */
  readonly protected?: boolean;
}

/**
 * A day of a week on which the host school gives no care (#4702): a
 * statutory holiday of its federal state or one of its closing days.
 */
export interface HolidayNoCareDay {
  /** Calendar date "YYYY-MM-DD". */
  readonly date: string;
  /** undefined: a kind this build does not know; the day still has no care. */
  readonly kind: (typeof NO_CARE_KIND_VALUES)[number] | undefined;
  readonly name: string;
}

/** A bookable week of a holiday period with the school that hosts it. */
export interface HolidayWeek {
  readonly id?: string;
  /** Calendar dates "YYYY-MM-DD". */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolId: string;
  readonly timeModels: readonly HolidayTimeModel[];
  /**
   * "week": parents book the whole week; "day": single days, and the price
   * of a time model is the price of one day (#4701). Absent reads as week.
   */
  readonly bookingUnit?: HolidayBookingUnit;
  /** Days without care of the stored week; such a week takes no new booking. Read only. */
  readonly noCareDays?: readonly HolidayNoCareDay[];
  /**
   * Price of one lunch in cent; null or absent offers no lunch (#5631). A
   * booking with lunch takes one lunch on each of its care days.
   */
  readonly lunchPriceCents?: number | null;
  /** A booking of the week has lunch, so the offer stays. Read only. */
  readonly lunchBooked?: boolean;
}

/** How a holiday week is booked (#4701). */
export type HolidayBookingUnit = (typeof BOOKING_UNIT_VALUES)[number];

/** What the Träger-Büro writes: the whole period with its weeks. */
export interface HolidayPeriodInput {
  readonly name: string;
  readonly registrationOpensOn: string;
  readonly registrationClosesOn: string;
  readonly binding: boolean;
  readonly notes: string;
  /**
   * The Träger's text in the mail parents get when the office confirms
   * their registration (#6672); empty sends the fixed part only.
   */
  readonly acceptanceMailText?: string;
  /**
   * Children with a holiday care wish from the OGS registration come first
   * (#4703); the Träger setting decides what happens without one.
   */
  readonly holidayWishRule: boolean;
  /**
   * Care days one child may book in the period; null or absent is no bound
   * (#4701).
   */
  readonly maxDaysPerChild?: number | null;
  /**
   * How places are given out (#4700): in the order of arrival, or by the
   * office after the Träger's criteria. Absent reads as arrival.
   */
  readonly allocationMode?: HolidayAllocationMode;
  readonly weeks: readonly HolidayWeek[];
}

/** How the places of a holiday period are given out (#4700). */
export type HolidayAllocationMode = (typeof ALLOCATION_MODE_VALUES)[number];

export interface HolidayPeriod extends HolidayPeriodInput {
  readonly id: string;
  /** undefined: a status this build does not know. */
  readonly status: (typeof PERIOD_STATUS_VALUES)[number] | undefined;
  readonly publishedAt: string | null;
  /** Key of the period's one public registration link (#4661). */
  readonly publicToken: string;
  /** Registrations received so far, a summed figure. */
  readonly registrationCount: number;
  /** The period has a registration, so its allocation stays (#4700). */
  readonly allocationModeLocked?: boolean;
}

function noCareDaysFromBackend(
  days: readonly sharedContract.HolidayNoCareDay[] | null,
): HolidayNoCareDay[] {
  return (days ?? []).map((day) => ({
    date: requiredDay(day.date, "holiday_no_care_day.date"),
    kind: knownEnum(NO_CARE_KIND_VALUES, day.kind),
    name: day.name,
  }));
}

function holidayPeriodFromBackend(
  period: traegerHolidayPeriodsContract.HolidayPeriod,
): HolidayPeriod {
  return {
    id: period.id,
    name: period.name,
    registrationOpensOn: requiredDay(
      period.registration_opens_on,
      "holiday_period.registration_opens_on",
    ),
    registrationClosesOn: requiredDay(
      period.registration_closes_on,
      "holiday_period.registration_closes_on",
    ),
    binding: period.binding,
    notes: period.notes,
    acceptanceMailText: period.acceptance_mail_text,
    holidayWishRule: period.holiday_wish_rule,
    status: knownEnum(PERIOD_STATUS_VALUES, period.status),
    publishedAt: period.published_at,
    publicToken: period.public_token,
    registrationCount: period.registration_count,
    maxDaysPerChild: period.max_days_per_child,
    allocationMode: knownEnum(ALLOCATION_MODE_VALUES, period.allocation_mode),
    allocationModeLocked: period.allocation_mode_locked,
    weeks: (period.weeks ?? []).map((week) => ({
      id: week.id,
      startsOn: requiredDay(week.starts_on, "holiday_week.starts_on"),
      endsOn: requiredDay(week.ends_on, "holiday_week.ends_on"),
      hostSchoolId: week.host_school_id,
      bookingUnit: knownEnum(BOOKING_UNIT_VALUES, week.booking_unit),
      noCareDays: noCareDaysFromBackend(week.no_care_days),
      // Only a week with lunch carries the fields (#5631).
      ...(week.lunch_price_cents == null
        ? {}
        : {
            lunchPriceCents: week.lunch_price_cents,
            lunchBooked: week.lunch_booked,
          }),
      timeModels: (week.time_models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        startsAt: model.starts_at,
        endsAt: model.ends_at,
        priceCents: model.price_cents,
        archived: model.archived,
        protected: model.protected,
      })),
    })),
  };
}

function holidayPeriodToBackend(
  input: HolidayPeriodInput,
): traegerHolidayPeriodsContract.HolidayPeriodRequest {
  return {
    name: input.name,
    registration_opens_on: input.registrationOpensOn,
    registration_closes_on: input.registrationClosesOn,
    binding: input.binding,
    notes: input.notes,
    acceptance_mail_text: input.acceptanceMailText ?? "",
    holiday_wish_rule: input.holidayWishRule,
    max_days_per_child: input.maxDaysPerChild ?? null,
    allocation_mode: input.allocationMode ?? "arrival",
    weeks: input.weeks.map((week) => ({
      ...(week.id ? { id: week.id } : {}),
      starts_on: week.startsOn,
      ends_on: week.endsOn,
      host_school_id: week.hostSchoolId,
      booking_unit: week.bookingUnit ?? "week",
      // Left out, the week offers no lunch (#5631).
      ...(week.lunchPriceCents == null
        ? {}
        : { lunch_price_cents: week.lunchPriceCents }),
      time_models: week.timeModels.map((model) => ({
        ...(model.id ? { id: model.id } : {}),
        name: model.name,
        starts_at: model.startsAt,
        ends_at: model.endsAt,
        price_cents: model.priceCents,
        archived: model.archived ?? false,
      })),
    })),
  };
}

// --- Träger-Büro: Personen und Einladungen (#4650) ---

/** An active person of the Träger-Büro. */
export interface TraegerMember {
  readonly accountId: string;
  readonly email: string;
  /**
   * The name the export protocol and the history of an invoice show
   * (#4693); empty while the person has none.
   */
  readonly name: string;
  readonly roles: readonly TraegerRole[];
}

/** An open invitation into the Träger-Büro. */
export interface TraegerInvitation {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly TraegerRole[];
  /** Instant (RFC 3339) after which the link no longer works. */
  readonly expiresAt: string;
}

export interface TraegerBuero {
  readonly members: readonly TraegerMember[];
  readonly invitations: readonly TraegerInvitation[];
}

/** What the invitation link shows before it is accepted. */
export interface TraegerInvitationPreview {
  readonly organizationName: string;
  readonly email: string;
  readonly roles: readonly TraegerRole[];
  /** The address has a moto account: the invitee confirms its password. */
  readonly requiresExistingPassword: boolean;
  readonly expiresAt: string;
}

/** Sends a request to a Träger BFF route and returns the `data` member. */
export async function traegerRequest<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const response = await transportFetch(path, {
    method: init.method,
    credentials: "include",
    cache: "no-store",
    headers:
      init.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      data,
    );
  }
  return (data as { data?: T } | null)?.data as T;
}

function mapInvitation(
  invitation: traegerAccountsContract.TraegerInvitationResponse,
): TraegerInvitation {
  return {
    id: invitation.id,
    email: invitation.email,
    roles: traegerRoles(invitation.roles ?? []),
    expiresAt: invitation.expires_at,
  };
}

function mapMember(
  member: traegerAccountsContract.TraegerMemberResponse,
): TraegerMember {
  return {
    accountId: member.account_id,
    email: member.email,
    name: member.name,
    roles: traegerRoles(member.roles ?? []),
  };
}

/** The people and the open invitations of the Träger-Büro. */
export async function fetchTraegerBuero(): Promise<TraegerBuero> {
  const data = await bffJson("org", "GET /traeger/accounts/");
  return {
    members: (data.members ?? []).map(mapMember),
    invitations: (data.invitations ?? []).map(mapInvitation),
  };
}

/** What a change of the Träger-Büro did (#5474). */
export type TraegerAccountChangeAction = (typeof ACCOUNT_ACTION_VALUES)[number];

/** One change of the Träger-Büro: who did what, when, to whom. */
export interface TraegerAccountHistoryEntry {
  /** Stable across pages; the next page starts before it. */
  readonly id: string;
  /** Instant (RFC 3339). */
  readonly occurredAt: string;
  /** undefined: an action this build does not know. */
  readonly action: TraegerAccountChangeAction | undefined;
  /** Empty for an account erased since; the page says „Gelöschtes Konto“. */
  readonly actorEmail: string;
  readonly targetEmail: string;
  /** The new name of a `name_changed` entry, else empty. */
  readonly targetName: string;
  readonly rolesBefore: readonly TraegerRole[];
  readonly rolesAfter: readonly TraegerRole[];
}

export interface TraegerAccountHistoryPage {
  readonly entries: readonly TraegerAccountHistoryEntry[];
  readonly hasMore: boolean;
}

/**
 * One page of the changes of the Träger-Büro, newest first. A later page
 * passes the ID of the last entry it has as `before`.
 */
export async function fetchTraegerAccountHistory(
  before?: string,
): Promise<TraegerAccountHistoryPage> {
  const data = await bffJson("org", "GET /traeger/accounts/history", {
    query: { before: before || undefined },
  });
  return {
    entries: (data.entries ?? []).map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurred_at,
      action: knownEnum(ACCOUNT_ACTION_VALUES, entry.action),
      actorEmail: entry.actor_email,
      targetEmail: entry.target_email,
      targetName: entry.target_name,
      rolesBefore: traegerRoles(entry.roles_before ?? []),
      rolesAfter: traegerRoles(entry.roles_after ?? []),
    })),
    hasMore: data.has_more,
  };
}

/** Invites a person by e-mail; the backend sends the link. */
export async function inviteTraegerAccount(input: {
  readonly email: string;
  readonly roles: readonly TraegerRole[];
}): Promise<void> {
  await bffJson("org", "POST /traeger/accounts/invitations", {
    body: { email: input.email, roles: [...input.roles] },
  });
}

export async function revokeTraegerInvitation(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/accounts/invitations/{invitationId}", {
    params: { invitationId: id },
  });
}

export async function changeTraegerRoles(
  accountId: string,
  roles: readonly TraegerRole[],
): Promise<void> {
  await bffJson("org", "PUT /traeger/accounts/{accountId}/roles", {
    params: { accountId },
    body: { roles: [...roles] },
  });
}

/**
 * Enters or changes the name of a person of the Träger-Büro (#4693) and
 * returns the person as saved (trimmed).
 */
export async function changeTraegerMemberName(
  accountId: string,
  name: string,
): Promise<TraegerMember> {
  return mapMember(
    await bffJson("org", "PUT /traeger/accounts/{accountId}/name", {
      params: { accountId },
      body: { name },
    }),
  );
}

export async function removeTraegerMember(accountId: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/accounts/{accountId}", {
    params: { accountId },
  });
}

/** Reads a redeemable invitation behind the link token. */
export async function fetchTraegerInvitation(
  token: string,
): Promise<TraegerInvitationPreview> {
  const data = await bffJson("public", "GET /traeger/invitations/{token}", {
    params: { token },
    errorMessage: "traeger invitation preview failed",
  });
  return {
    organizationName: data.organization_name,
    email: data.email,
    roles: traegerRoles(data.roles ?? []),
    requiresExistingPassword: data.requires_existing_password,
    expiresAt: data.expires_at,
  };
}

/** Accepts the invitation and returns the address to sign in with. */
export async function acceptTraegerInvitation(
  token: string,
  input: {
    /** The person's name in this Träger-Büro (#4693). */
    readonly name: string;
    readonly password: string;
    readonly confirmPassword?: string;
  },
): Promise<string> {
  const data = await bffJson(
    "public",
    "POST /traeger/invitations/{token}/accept",
    {
      params: { token },
      errorMessage: "traeger invitation acceptance failed",
      body: {
        name: input.name,
        password: input.password,
        confirm_password: input.confirmPassword ?? "",
      },
    },
  );
  return data.email;
}

/** The signed-in person in this Träger-Büro: sign-in address and name. */
export interface TraegerProfile {
  readonly accountId: string;
  readonly email: string;
  /** Empty while the person has none. */
  readonly name: string;
}

function mapProfile(
  profile: traegerProfileContract.TraegerProfileResponse,
): TraegerProfile {
  return {
    accountId: profile.account_id,
    email: profile.email,
    name: profile.name,
  };
}

/** The own account of the signed-in person (#4693); needs no extra right. */
export async function fetchTraegerProfile(): Promise<TraegerProfile> {
  return mapProfile(await bffJson("org", "GET /traeger/profile/"));
}

/** Changes the own name and returns the profile as saved (trimmed). */
export async function changeTraegerProfileName(
  name: string,
): Promise<TraegerProfile> {
  return mapProfile(
    await bffJson("org", "PUT /traeger/profile/name", { body: { name } }),
  );
}

/** Every holiday period of the signed-in person's Träger, newest first. */
export async function fetchHolidayPeriods(): Promise<HolidayPeriod[]> {
  const periods = (await bffJson("org", "GET /traeger/holiday-periods/")) ?? [];
  return periods.map(holidayPeriodFromBackend);
}

/** One holiday period of the Träger. */
export async function fetchHolidayPeriod(id: string): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("org", "GET /traeger/holiday-periods/{id}", {
      params: { id },
    }),
  );
}

/** Creates a holiday period as a draft. */
export async function createHolidayPeriod(
  input: HolidayPeriodInput,
): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("org", "POST /traeger/holiday-periods/", {
      body: holidayPeriodToBackend(input),
    }),
  );
}

/** Saves the whole period; weeks and time models left out are removed. */
export async function updateHolidayPeriod(
  id: string,
  input: HolidayPeriodInput,
): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("org", "PUT /traeger/holiday-periods/{id}", {
      params: { id },
      body: holidayPeriodToBackend(input),
    }),
  );
}

/** Publishes a complete period for registration. */
export async function publishHolidayPeriod(id: string): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("org", "POST /traeger/holiday-periods/{id}/publish", {
      params: { id },
    }),
  );
}

// --- Zugriffsprotokoll (#4655) ---

/** Whether an access log entry read data or changed it. */
export type TraegerAccessKind = (typeof ACCESS_KIND_VALUES)[number];

/** The filter of the access log (#4655). Days are `YYYY-MM-DD`, both included. */
export interface TraegerAccessLogFilter {
  readonly from: string;
  readonly to: string;
  /** Empty for every school. */
  readonly schoolId: string;
  /** Empty for every person. */
  readonly accountId: string;
  /** Empty for both kinds. */
  readonly kind: TraegerAccessKind | "";
}

/** One read or change of personal data at a school of the Träger. */
export interface TraegerAccessLogEntry {
  /** Stable across pages. */
  readonly id: string;
  readonly occurredAt: string;
  readonly schoolId: string;
  readonly schoolName: string;
  /** Null when no person is recorded, e.g. for an automatic step. */
  readonly accountId: string | null;
  readonly person: string;
  /** undefined: a kind this build does not know. */
  readonly kind: TraegerAccessKind | undefined;
  readonly dataLabel: string;
}

export interface TraegerAccessLogPage {
  readonly entries: TraegerAccessLogEntry[];
  readonly hasMore: boolean;
  /** The instant the list reads up to; later pages of the list send it back. */
  readonly asOf: string;
}

/** A person the access log can be filtered by. */
export interface TraegerAccessLogPerson {
  readonly accountId: string;
  readonly name: string;
}

/** The query of a filter, as the backend reads it. */
function traegerAccessLogQuery(
  filter: TraegerAccessLogFilter,
  page?: number,
  asOf?: string,
) {
  return {
    from: filter.from,
    to: filter.to,
    school_id: filter.schoolId || undefined,
    account_id: filter.accountId || undefined,
    kind: filter.kind || undefined,
    page,
    as_of: asOf || undefined,
  };
}

/**
 * One page of the access log, newest first. Pages start at 1; the pages after
 * the first pass the first page's `asOf`, so entries recorded meanwhile
 * (including this read itself) never shift into a later page.
 */
export async function fetchTraegerAccessLog(
  filter: TraegerAccessLogFilter,
  page: number,
  asOf?: string,
): Promise<TraegerAccessLogPage> {
  const data = await bffJson("org", "GET /traeger/access-log/", {
    query: traegerAccessLogQuery(filter, page, asOf),
  });
  return {
    entries: (data.entries ?? []).map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurred_at,
      schoolId: entry.school_id,
      schoolName: entry.school_name,
      accountId: entry.account_id,
      person: entry.person,
      kind: knownEnum(ACCESS_KIND_VALUES, entry.kind),
      dataLabel: entry.data_label,
    })),
    hasMore: data.has_more,
    asOf: data.as_of,
  };
}

/** The people with an entry between `from` and `to`, for the person filter. */
export async function fetchTraegerAccessLogPeople(
  from: string,
  to: string,
): Promise<TraegerAccessLogPerson[]> {
  const data = await bffJson("org", "GET /traeger/access-log/people", {
    query: { from, to },
  });
  return (data ?? []).map((person) => ({
    accountId: person.account_id,
    name: person.name,
  }));
}

/** The CSV export of a filter, with the file name the backend chose. */
export async function downloadTraegerAccessLog(
  filter: TraegerAccessLogFilter,
  format: TraegerListFormat,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await bffFile("org", "GET /traeger/access-log/export", {
    query: { ...traegerAccessLogQuery(filter), format },
  });
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

// --- Träger-Einstellungen (ADR 0086, #4652) ---

/**
 * The settings the Träger sets for all its schools: only settings with the
 * levels `beide` or `traeger`, each with the Träger value or the registry
 * default.
 */
export async function fetchTraegerSettingsSchema(): Promise<SettingsSchema> {
  return toSettingsSchema(await bffJson("org", "GET /traeger/settings/schema"));
}

/** Sets the Träger value of one setting. Throws an ApiError on failure. */
export async function saveTraegerSettingValue(
  key: string,
  value: unknown,
): Promise<void> {
  await bffJson("org", "PUT /traeger/settings/values/{key}", {
    params: { key },
    body: { value },
  });
}

/**
 * Removes the Träger value of one setting: schools fall back to the default
 * or keep their own value. Throws an ApiError on failure.
 */
export async function clearTraegerSettingValue(key: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/settings/values/{key}", {
    params: { key },
  });
}

/** The Träger of the session, as the portal frame names and marks it. */
export interface TraegerOrganization {
  readonly id: string;
  readonly name: string;
  /** A test Träger with invented sample data (#4658). */
  readonly testSystem: boolean;
  /** The federal states of its schools, each once (#4717). */
  readonly federalStates: readonly string[];
}

/** The Träger of the signed-in person's session. */
export async function fetchTraegerOrganization(): Promise<TraegerOrganization> {
  const organization = await bffJson("org", "GET /traeger/organization/");
  if (!organization) {
    throw apiErrorFromBody("Träger response without data", 502, organization);
  }
  return {
    id: organization.id,
    name: organization.name,
    testSystem: organization.test_system,
    federalStates: organization.federal_states ?? [],
  };
}

/** The largest logo the backend takes (#4653, ADR 0112). */
export const TRAEGER_LOGO_MAX_BYTES = 1024 * 1024;

/** The stored logo of the Träger, without its bytes. */
export interface TraegerLogo {
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}

/** The contact person documents of the Träger name. */
export interface TraegerContact {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
}

/**
 * The phone and e-mail the withdrawal notice of a care contract names
 * (#6200). An empty field takes the contact person's.
 */
export interface TraegerWithdrawalContact {
  readonly phone: string;
  readonly email: string;
}

/** A bank account as the Träger-Büro writes it. */
export interface TraegerBankAccountInput {
  readonly label: string;
  readonly accountHolder: string;
  readonly iban: string;
  readonly bic: string;
  readonly bankName: string;
  readonly isDefault: boolean;
}

/** A bank account of the Träger; exactly one is the default. */
export interface TraegerBankAccount extends TraegerBankAccountInput {
  readonly id: string;
}

/** The master data of the Träger (#4653). */
export interface TraegerMasterData {
  readonly contact: TraegerContact;
  readonly withdrawal: TraegerWithdrawalContact;
  readonly logo: TraegerLogo | null;
  readonly bankAccounts: readonly TraegerBankAccount[];
}

function mapTraegerLogo(
  logo: traegerMasterDataContract.TraegerLogo,
): TraegerLogo {
  return {
    contentType: logo.content_type,
    width: logo.width,
    height: logo.height,
    sizeBytes: logo.size_bytes,
    updatedAt: logo.updated_at,
  };
}

function mapTraegerBankAccount(
  account: traegerMasterDataContract.TraegerBankAccount,
): TraegerBankAccount {
  return {
    id: account.id,
    label: account.label,
    accountHolder: account.account_holder,
    iban: account.iban,
    bic: account.bic,
    bankName: account.bank_name,
    isDefault: account.is_default,
  };
}

function backendBankAccount(
  input: TraegerBankAccountInput,
): traegerMasterDataContract.BankAccountRequest {
  return {
    label: input.label,
    account_holder: input.accountHolder,
    iban: input.iban,
    bic: input.bic,
    bank_name: input.bankName,
    is_default: input.isDefault,
  };
}

const masterDataPath = "/api/traeger/master-data";

/** The logo as an image source; the version reloads it after a change. */
export function traegerLogoSrc(logo: TraegerLogo): string {
  return `${masterDataPath}/logo?v=${encodeURIComponent(logo.updatedAt)}`;
}

/** Reads the master data of the Träger. The read is logged. */
export async function fetchTraegerMasterData(): Promise<TraegerMasterData> {
  const data = await bffJson("org", "GET /traeger/master-data/");
  return {
    contact: { ...data.contact },
    withdrawal: { ...data.withdrawal },
    logo: data.logo ? mapTraegerLogo(data.logo) : null,
    bankAccounts: (data.bank_accounts ?? []).map(mapTraegerBankAccount),
  };
}

/**
 * Stores the contact person and returns it as the backend keeps it: trimmed,
 * the e-mail address in lower case. Throws an ApiError on failure.
 */
export async function saveTraegerContact(
  contact: TraegerContact,
): Promise<TraegerContact> {
  const saved = await bffJson("org", "PUT /traeger/master-data/contact", {
    body: contact,
  });
  return {
    name: saved?.name ?? contact.name,
    phone: saved?.phone ?? contact.phone,
    email: saved?.email ?? contact.email,
  };
}

/**
 * Stores the phone and e-mail for withdrawals and returns them as the
 * backend keeps them. Throws an ApiError on failure.
 */
export async function saveTraegerWithdrawalContact(
  contact: TraegerWithdrawalContact,
): Promise<TraegerWithdrawalContact> {
  const saved = await bffJson(
    "org",
    "PUT /traeger/master-data/withdrawal-contact",
    { body: contact },
  );
  return {
    phone: saved?.phone ?? contact.phone,
    email: saved?.email ?? contact.email,
  };
}

/** Uploads a PNG or JPEG logo in place of the old one. */
export async function uploadTraegerLogo(file: File): Promise<TraegerLogo> {
  const form = new FormData();
  form.append("logo", file);
  return mapTraegerLogo(
    await bffJson("org", "PUT /traeger/master-data/logo", { body: form }),
  );
}

/** Removes the logo. Throws an ApiError on failure. */
export async function removeTraegerLogo(): Promise<void> {
  await bffJson("org", "DELETE /traeger/master-data/logo");
}

/** Adds a bank account. Throws an ApiError on failure. */
export async function createTraegerBankAccount(
  input: TraegerBankAccountInput,
): Promise<TraegerBankAccount> {
  return mapTraegerBankAccount(
    await bffJson("org", "POST /traeger/master-data/bank-accounts", {
      body: backendBankAccount(input),
    }),
  );
}

/** Changes a bank account. Throws an ApiError on failure. */
export async function updateTraegerBankAccount(
  id: string,
  input: TraegerBankAccountInput,
): Promise<TraegerBankAccount> {
  return mapTraegerBankAccount(
    await bffJson("org", "PUT /traeger/master-data/bank-accounts/{id}", {
      params: { id },
      body: backendBankAccount(input),
    }),
  );
}

/** Deletes a bank account. Throws an ApiError on failure. */
export async function deleteTraegerBankAccount(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/master-data/bank-accounts/{id}", {
    params: { id },
  });
}
