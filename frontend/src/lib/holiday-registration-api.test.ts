import { afterEach, describe, expect, it, vi } from "vitest";
import type * as traegerHolidayRegistrationsContract from "./contract/traeger-holiday-registrations.generated";
import {
  fetchHolidayRegistrationFamily,
  fetchHolidayRegistrationOffer,
  quoteHolidayContribution,
} from "./holiday-registration-api";

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchHolidayRegistrationFamily (#4662)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the family of the parent session for the link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      answer(200, {
        data: {
          guardian: {
            first_name: "Sabine",
            last_name: "Schneider",
            email: "s@example.org",
            phone: "0151",
            address: {
              street: "Lindenweg 4",
              postal_code: "49143",
              city: "Bissendorf",
            },
          },
          children: [
            {
              student_id: "41",
              school_id: "31",
              first_name: "Felix",
              last_name: "Schneider",
              birth_date: "2018-03-01",
              contacts: [
                {
                  guardian_profile_id: "51",
                  first_name: "Erika",
                  last_name: "Brandt",
                  phone: "0170 1",
                  relationship_type: "relative",
                  full_guardian: false,
                  emergency: true,
                  pickup: true,
                },
              ],
            },
            {
              student_id: "42",
              school_id: "31",
              first_name: "Mia",
              last_name: "Schneider",
              contacts: null,
            },
          ],
          account_proof: "",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const family = await fetchHolidayRegistrationFamily("a/b");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/parent/holiday-registrations/a%2Fb/family",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(family).toEqual({
      guardian: {
        firstName: "Sabine",
        lastName: "Schneider",
        email: "s@example.org",
        phone: "0151",
        address: {
          street: "Lindenweg 4",
          postalCode: "49143",
          city: "Bissendorf",
        },
      },
      children: [
        {
          studentId: "41",
          schoolId: "31",
          firstName: "Felix",
          lastName: "Schneider",
          birthDate: "2018-03-01",
          holidayWish: "",
          holidayWishProof: "",
          contacts: [
            {
              guardianProfileId: "51",
              firstName: "Erika",
              lastName: "Brandt",
              email: "",
              phone: "0170 1",
              relationshipType: "relative",
              fullGuardian: false,
              emergency: true,
              pickup: true,
            },
          ],
        },
        {
          studentId: "42",
          schoolId: "31",
          firstName: "Mia",
          lastName: "Schneider",
          birthDate: "",
          holidayWish: "",
          holidayWishProof: "",
          contacts: [],
        },
      ],
      accountProof: "",
    });
  });

  it("hands the account's proof on for the registration (#6673)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        answer(200, {
          data: {
            guardian: {
              first_name: "Sabine",
              last_name: "Schneider",
              email: "s@example.org",
              phone: "0151",
            },
            children: [],
            account_proof: "sealed-proof",
          },
        }),
      ),
    );
    const family = await fetchHolidayRegistrationFamily("token");
    expect(family?.accountProof).toBe("sealed-proof");
  });

  it("starts empty without a parent session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(401, {})));
    await expect(fetchHolidayRegistrationFamily("token")).resolves.toBeNull();
  });

  it("names the refusal of an unknown link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        answer(404, {
          status: 404,
          code: "enrollment.holiday_registration_not_found",
          detail: "holiday registration link not found",
        }),
      ),
    );
    await expect(fetchHolidayRegistrationFamily("token")).rejects.toMatchObject(
      { status: 404, code: "enrollment.holiday_registration_not_found" },
    );
  });
});

describe("quoteHolidayContribution (#5664)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the order of the children by age, never a date of birth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [],
            total_cents: 0,
            exemption_available: false,
            benefits_exemption: false,
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await quoteHolidayContribution(
      "abc",
      [[{ week_id: "1", time_model_id: "2" }], []],
      false,
      [2, 1],
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as unknown;
    expect(body).toEqual({
      children: [
        { bookings: [{ week_id: "1", time_model_id: "2" }], age_rank: 2 },
        { bookings: [], age_rank: 1 },
      ],
      benefits_declared: false,
    });
  });
});

describe("fetchHolidayRegistrationOffer form (#2353)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function offer(
    form: Partial<
      traegerHolidayRegistrationsContract.PublicHolidayRegistrationOfferResponse["form"]
    >,
  ): traegerHolidayRegistrationsContract.PublicHolidayRegistrationOfferResponse {
    return {
      traeger_name: "Träger",
      name: "Herbstferien",
      registration_opens_on: "2026-09-01",
      registration_closes_on: "2026-10-01",
      binding: true,
      notes: "",
      open: true,
      weeks: null,
      max_days_per_child: null,
      allocation_mode: "",
      criteria: null,
      schools: null,
      captcha_site_key: "",
      form: {
        version: 2,
        fields: [
          {
            key: "klasse",
            label: "Klasse",
            type: "text",
            required: true,
            sort_order: 1,
            health: false,
            share_with_host: false,
          },
        ],
        legal_blocks: null,
        address_requirement: "off",
        health_requirement: "required",
        ...form,
      },
      consent_texts: {
        version: 1,
        retention_days: 90,
        privacy_consent: "",
        health_consent: "",
        binding_confirmed: "",
        custody_confirmed: "",
        declaration_name: "",
      },
      holiday_wish_mode: "off",
    };
  }

  function answerWith(
    data: traegerHolidayRegistrationsContract.PublicHolidayRegistrationOfferResponse,
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(answer(200, { status: "success", data })),
    );
  }

  it("reads the questions and building blocks of the version", async () => {
    answerWith(offer({}));

    const { form } = await fetchHolidayRegistrationOffer("tok");

    expect(form.fields.map((field) => [field.key, field.required])).toEqual([
      ["klasse", true],
    ]);
    expect(form.healthRequirement).toBe("required");
  });

  // Read only, yet leaving an unknown question or rule out could hide a
  // required answer the backend refuses when the registration arrives.
  it.each([
    [
      "a field type",
      {
        fields: [
          {
            key: "unterschrift",
            label: "Unterschrift",
            type: "signature_pad",
            required: true,
            sort_order: 1,
            health: false,
            share_with_host: false,
          },
        ],
      },
    ],
    [
      "a legal block kind",
      {
        legal_blocks: [
          {
            key: "x",
            kind: "waiver",
            title: "",
            label: "",
            text: "",
            required: true,
            enabled: true,
            sort_order: 0,
          },
        ],
      },
    ],
    ["a health requirement", { health_requirement: "strict" }],
  ] satisfies [
    string,
    Partial<
      traegerHolidayRegistrationsContract.PublicHolidayRegistrationOfferResponse["form"]
    >,
  ][])("fails the read on %s this build does not know", async (_name, form) => {
    answerWith(offer(form));

    await expect(fetchHolidayRegistrationOffer("tok")).rejects.toThrow(
      /^contract: HolidayRegistrationForm\..+ has an unknown value$/,
    );
  });
});
