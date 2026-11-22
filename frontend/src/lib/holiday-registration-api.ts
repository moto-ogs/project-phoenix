// Öffentliche Ferienanmeldung (#4661): der eine Link eines Ferienzeitraums
// für alle Schulen des Trägers, ohne Elternkonto.

import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "~/lib/contract/known-enum";
import { requiredDay } from "~/lib/contract/required-day";
import type * as parentHolidayRegistrationsContract from "~/lib/contract/parent-holiday-registrations.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import type * as traegerHolidayQuotesContract from "~/lib/contract/traeger-holiday-quotes.generated";
import type * as traegerHolidayRegistrationsContract from "~/lib/contract/traeger-holiday-registrations.generated";
import {
  knownHolidayPlacement,
  type HolidayPlacement,
} from "~/lib/parent-holiday-registration-entries";
import {
  holidayFormVersionFromContract,
  type HolidayFormVersion,
} from "~/lib/holiday-form-field";
import {
  contributionFromBackend,
  type HolidayContribution,
} from "~/lib/holiday-contribution";
import {
  consentTextsFromBackend,
  type HolidayConsentTexts,
} from "~/lib/holiday-consent-texts";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const BOOKING_UNIT_VALUES = ["week", "day"] as const;
const ALLOCATION_MODE_VALUES = ["arrival", "criteria"] as const;
const HOLIDAY_WISH_MODE_VALUES = ["off", "priority", "wish_only"] as const;
const CRITERION_SCOPE_VALUES = ["family", "child"] as const;
const HOLIDAY_WISH_VALUES = ["yes", "no"] as const;

export interface HolidayRegistrationTimeModel {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /**
   * Price in cent: per week, or per day in a week by days (#4701); the base
   * line of the contribution (#5237).
   */
  readonly priceCents: number;
}

export interface HolidayRegistrationWeek {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolName: string;
  readonly timeModels: readonly HolidayRegistrationTimeModel[];
  /**
   * "day": parents choose single days and prices are per day (#4701).
   * undefined (a unit this build does not know) books like a week.
   */
  readonly bookingUnit?: (typeof BOOKING_UNIT_VALUES)[number];
  /**
   * The days a week by days offers, Monday to Friday without the days
   * without care, "YYYY-MM-DD".
   */
  readonly careDays?: readonly string[];
  /** Days of a week by days without a free place: a booking of them waits. */
  readonly fullDays?: readonly string[];
  /**
   * Days without care at the host school (#4702); a week booked as a whole
   * with such a day is not bookable, a week by days leaves the day out.
   */
  readonly noCareDays?: readonly {
    readonly date: string;
    readonly name: string;
  }[];
  /**
   * Price of one lunch in cent; null or absent offers no lunch (#5631). A
   * child with lunch eats on each of its care days: `lunchDays` for a whole
   * week, its chosen days in a week by days.
   */
  readonly lunchPriceCents?: number | null;
  readonly lunchDays?: number;
}

interface HolidayRegistrationSchool {
  readonly id: string;
  readonly name: string;
}

/**
 * A yes/no question of the Träger for the allocation of places (#4700),
 * asked once for the family or for every child. Parents see the question
 * only, never the answers of other families.
 */
interface HolidayRegistrationCriterion {
  readonly id: string;
  readonly question: string;
  readonly scope: (typeof CRITERION_SCOPE_VALUES)[number];
}

/** The published holiday period behind a link. */
export interface HolidayRegistrationOffer {
  readonly traegerName: string;
  readonly name: string;
  readonly registrationOpensOn: string;
  readonly registrationClosesOn: string;
  readonly binding: boolean;
  readonly notes: string;
  readonly open: boolean;
  readonly weeks: readonly HolidayRegistrationWeek[];
  /** Care days one child may book over all weeks; null is no bound (#4701). */
  readonly maxDaysPerChild?: number | null;
  readonly schools: readonly HolidayRegistrationSchool[];
  readonly captchaSiteKey: string;
  /** The questions of the Träger in their current version (#5198). */
  readonly form: HolidayFormVersion;
  /** The German texts of the declarations the form shows (#5626). */
  readonly consentTexts: HolidayConsentTexts;
  /**
   * Whether the period takes the holiday care wish of the OGS registration
   * into account and how (#4703).
   */
  readonly holidayWishMode: HolidayWishMode;
  /**
   * "criteria": the office gives the places after the Träger's criteria;
   * nobody gets a place at once (#4700). Absent reads as arrival.
   */
  readonly allocationMode?: (typeof ALLOCATION_MODE_VALUES)[number];
  /** The active criteria, only by criteria; empty otherwise. */
  readonly criteria?: readonly HolidayRegistrationCriterion[];
}

/**
 * "off": the wish does not count; "priority": children without a wish wait
 * behind; "wish_only": only children with a wish can register (#4703).
 */
type HolidayWishMode = (typeof HOLIDAY_WISH_MODE_VALUES)[number];

/** The days of a list the decoder may leave null, without the empty ones. */
function presentDays(days: readonly (string | null)[] | null): string[] {
  return (days ?? []).filter((day): day is string => day !== null);
}

function offerFromBackend(
  offer: traegerHolidayRegistrationsContract.PublicHolidayRegistrationOfferResponse,
): HolidayRegistrationOffer {
  return {
    traegerName: offer.traeger_name,
    name: offer.name,
    registrationOpensOn: requiredDay(
      offer.registration_opens_on,
      "HolidayRegistrationOffer.registration_opens_on",
    ),
    registrationClosesOn: requiredDay(
      offer.registration_closes_on,
      "HolidayRegistrationOffer.registration_closes_on",
    ),
    binding: offer.binding,
    notes: offer.notes,
    open: offer.open,
    weeks: (offer.weeks ?? []).map((week) => ({
      id: week.id,
      startsOn: requiredDay(
        week.starts_on,
        "HolidayRegistrationWeek.starts_on",
      ),
      endsOn: requiredDay(week.ends_on, "HolidayRegistrationWeek.ends_on"),
      hostSchoolName: week.host_school_name,
      noCareDays: (week.no_care_days ?? []).map((day) => ({
        date: requiredDay(day.date, "HolidayNoCareDay.date"),
        name: day.name,
      })),
      timeModels: (week.time_models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        startsAt: model.starts_at,
        endsAt: model.ends_at,
        priceCents: model.price_cents,
      })),
      bookingUnit: knownEnum(BOOKING_UNIT_VALUES, week.booking_unit),
      careDays: presentDays(week.care_days),
      fullDays: presentDays(week.full_days),
      lunchPriceCents: week.lunch_price_cents,
      lunchDays: week.lunch_days,
    })),
    maxDaysPerChild: offer.max_days_per_child,
    schools: (offer.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
    })),
    captchaSiteKey: offer.captcha_site_key,
    // Read only, but a question, legal block or rule this build does not
    // know fails the read too: leaving it out could hide a required answer
    // or consent the backend then refuses when the registration arrives.
    form: holidayFormVersionFromContract(offer.form, "HolidayRegistrationForm"),
    consentTexts: consentTextsFromBackend(offer.consent_texts),
    // Go itself answers "off" for a Träger without a choice; the backend
    // checks every wish again when the registration arrives.
    holidayWishMode:
      knownEnum(HOLIDAY_WISH_MODE_VALUES, offer.holiday_wish_mode) ?? "off",
    allocationMode: knownEnum(ALLOCATION_MODE_VALUES, offer.allocation_mode),
    criteria:
      offer.allocation_mode === "criteria"
        ? (offer.criteria ?? []).flatMap((criterion) => {
            const scope = knownEnum(CRITERION_SCOPE_VALUES, criterion.scope);
            return scope === undefined
              ? []
              : [{ id: criterion.id, question: criterion.question, scope }];
          })
        : [],
  };
}

export async function fetchHolidayRegistrationOffer(
  token: string,
): Promise<HolidayRegistrationOffer> {
  return offerFromBackend(
    await bffJson("public", "GET /traeger/holiday-registrations/{token}", {
      params: { token },
      errorMessage: "Ferienanmeldung konnte nicht geladen werden",
    }),
  );
}

/**
 * Uploads one proof of benefits through the public link (#5238). Like the
 * uploads of the online registration, the answer's token is single-use and
 * claimed by the registration.
 */
export function uploadHolidayProof(
  token: string,
  file: File,
  signal?: AbortSignal,
): Promise<sharedContract.UploadReceipt> {
  const body = new FormData();
  body.append("file", file);
  return bffJson(
    "public",
    "POST /traeger/holiday-registrations/{token}/uploads",
    {
      params: { token },
      body,
      ...(signal && { signal }),
      errorMessage: "Datei konnte nicht hochgeladen werden",
    },
  );
}

/**
 * Whether one booking of the sent registration got a place or waits on the
 * waiting list of its week (#4699), or waits for the office to give the
 * places (#4700). The child is named by its position in the form, from 1.
 */
export interface HolidayReceiptPlacement {
  readonly childPosition: number;
  readonly weekId: string;
  /** undefined: a placement this build does not know. */
  readonly placement: HolidayPlacement | undefined;
}

/**
 * The answer of a sent registration: the place of every booking and the
 * token of its status page (#6676), "" when the answer has none.
 */
export interface HolidayRegistrationReceipt {
  readonly placements: readonly HolidayReceiptPlacement[];
  readonly statusToken: string;
}

/** Sends the registration and answers with the place of every booking. */
export async function submitHolidayRegistration(
  token: string,
  payload: traegerHolidayRegistrationsContract.HolidayRegistrationRequest,
): Promise<HolidayRegistrationReceipt> {
  const receipt = await bffJson(
    "public",
    "POST /traeger/holiday-registrations/{token}",
    {
      params: { token },
      body: payload,
      errorMessage: "Ferienanmeldung konnte nicht gesendet werden",
    },
  );
  return {
    placements: (receipt.placements ?? []).map((entry) => ({
      childPosition: entry.child_position,
      weekId: entry.week_id,
      placement: knownHolidayPlacement(entry.placement),
    })),
    statusToken: receipt.status_token,
  };
}

/**
 * The contribution of the form before it is sent (#4664): computed by the
 * Träger's rules from the bookings and the order of the children by age,
 * stored nowhere. Every child of the form is the list of its bookings.
 */
export async function quoteHolidayContribution(
  token: string,
  children: readonly traegerHolidayQuotesContract.holidayQuoteBookingRequest[][],
  benefitsDeclared: boolean,
  ageRanks: readonly number[] = [],
): Promise<HolidayContribution> {
  return contributionFromBackend(
    await bffJson("public", "POST /traeger/holiday-quotes/{token}", {
      params: { token },
      body: {
        children: children.map((bookings, index) => ({
          bookings,
          age_rank: ageRanks[index] ?? 0,
        })),
        benefits_declared: benefitsDeclared,
      },
      errorMessage: "Beitrag der Ferienanmeldung konnte nicht berechnet werden",
    }),
  );
}

/** A child of the parent's account the registration can start from (#4662). */
export interface HolidayKnownChild {
  readonly studentId: string;
  readonly schoolId: string;
  readonly firstName: string;
  readonly lastName: string;
  /** "YYYY-MM-DD", or "" when the school knows no date of birth. */
  readonly birthDate: string;
  /**
   * The holiday care wish from the OGS registration, when the period takes
   * it into account (#4703): "yes", "no" or "" when the school does not
   * know it. Only the parent with the relationship right gets it.
   */
  readonly holidayWish: "yes" | "no" | "";
  /** The sealed statement the form sends back with the child. */
  readonly holidayWishProof: string;
  /**
   * The child's other guardians as the school knows them (#6682): the second
   * custodian and the emergency and pickup contacts. Never health data.
   */
  readonly contacts: readonly HolidayKnownContact[];
}

/**
 * Another guardian of a known child (#6682). Email and phone are "" when
 * the school knows none; an own account does not hide them here.
 */
export interface HolidayKnownContact {
  readonly guardianProfileId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  /** "parent", "guardian", "relative", "other" or "". */
  readonly relationshipType: string;
  /** A custodian: offered as the second custodian. */
  readonly fullGuardian: boolean;
  readonly emergency: boolean;
  readonly pickup: boolean;
}

/** What the schools of the Träger know of a parent with an account. */
export interface HolidayKnownFamily {
  readonly guardian: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string;
    /** The parent's postal address as the school knows it (#6682). */
    readonly address: {
      readonly street: string;
      readonly postalCode: string;
      readonly city: string;
    } | null;
  };
  readonly children: readonly HolidayKnownChild[];
  /**
   * The sealed proof of the signed-in account (#6673, ADR 0216). The form
   * sends it back, so the registration is linked to the account at once.
   * "" when the prefill carries none.
   */
  readonly accountProof: string;
}

/**
 * Loads the prefill for a parent with an account: the children the parent
 * may register at the schools of the link's Träger, and the parent's contact
 * data. Answers null without a parent session; the form then starts empty.
 */
export async function fetchHolidayRegistrationFamily(
  token: string,
): Promise<HolidayKnownFamily | null> {
  let data: parentHolidayRegistrationsContract.HolidayRegistrationFamilyResponse;
  try {
    data = await bffJson(
      "parent",
      "GET /parent/holiday-registrations/{token}/family",
      {
        params: { token },
        // Without a parent session the form starts empty, on this page.
        authRefusals: ["general.permission"],
        errorMessage: "Bekannte Angaben konnten nicht geladen werden",
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
  return {
    guardian: {
      firstName: data.guardian.first_name,
      lastName: data.guardian.last_name,
      email: data.guardian.email,
      phone: data.guardian.phone,
      address: data.guardian.address
        ? {
            street: data.guardian.address.street,
            postalCode: data.guardian.address.postal_code,
            city: data.guardian.address.city,
          }
        : null,
    },
    children: (data.children ?? []).map((child) => ({
      studentId: child.student_id,
      schoolId: child.school_id,
      firstName: child.first_name,
      lastName: child.last_name,
      birthDate: child.birth_date ?? "",
      holidayWish: knownEnum(HOLIDAY_WISH_VALUES, child.holiday_wish) ?? "",
      holidayWishProof: child.holiday_wish_proof ?? "",
      contacts: (child.contacts ?? []).map((contact) => ({
        guardianProfileId: contact.guardian_profile_id,
        firstName: contact.first_name,
        lastName: contact.last_name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        relationshipType: contact.relationship_type,
        fullGuardian: contact.full_guardian,
        emergency: contact.emergency,
        pickup: contact.pickup,
      })),
    })),
    accountProof: data.account_proof,
  };
}
