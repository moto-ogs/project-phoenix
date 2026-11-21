import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TraegerOffering as OfferingWire,
  PhaseDetail,
  Preview,
  Rollout,
} from "./contract/traeger-catalog.generated";
import {
  createTraegerOffering,
  fetchTraegerPhase,
  previewTraegerPhase,
  rolloutTraegerPhase,
  updateTraegerOffering,
  updateTraegerPhase,
} from "./traeger-catalog-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("./traeger-api", () => ({ traegerRequest: request }));
afterEach(() => request.mockReset());

// The decoded answer of the proxy: string IDs, every field Go always sends.
const offeringWire: OfferingWire = {
  id: "31",
  organization_id: "2",
  traeger_phase_id: "7",
  updated_at: "2026-11-11T10:00:00Z",
  draft: {
    fields: {
      name: "Frühbetreuung",
      description: null,
      days_of_week_mode: "fixed",
      available_days: ["mon", "tue"],
      includes_holiday_care: false,
      includes_lunch: false,
      capacity: null,
      price_cents: null,
      is_required: false,
      counts_as_care: true,
      selection_group: "",
      selection_rule: "optional",
      sort_order: 0,
      pickup_times: { mon: "08:30", tue: "08:30" },
    },
    prices: [
      {
        weekday: "mon",
        monthly_cents: 650,
        sibling_cents: 500,
        meal_extra: false,
      },
      { weekday: "tue", monthly_cents: 650, meal_extra: false },
    ],
    contract_template: {
      term_kind: "school_year",
      notice_months: 1,
      notice_to: "month_end",
      special_termination: false,
      special_termination_note: "",
      statute_required: false,
      statute_title: "",
      statute_url: "",
      contract_partner: "",
    },
  },
  schools: [{ school_id: "11", applied_version: 1, outcome: "applied" }],
};

const backendPhase: PhaseDetail = {
  id: "7",
  organization_id: "2",
  draft: {
    name: "Schuljahr 2027/28",
    kind: "school_year",
    service_start_date: "2027-08-01",
    service_end_date: "2028-07-31",
    enrollment_open_at: null,
    enrollment_close_at: null,
    audience: "open",
    care_overflow_mode: "waitlist",
    care_offering_selection_mode: "optional",
  },
  all_schools: false,
  released_version: 2,
  schools: [
    {
      school_id: "11",
      selected: true,
      applied_version: 2,
      outcome: "applied",
    },
    {
      school_id: "12",
      selected: true,
      outcome: "rejected",
      error_code: "enrollment.traeger_copy_rejected",
    },
  ],
  updated_at: "2026-11-11T10:00:00Z",
  offerings: [offeringWire],
};

describe("Träger catalog requests (#4704)", () => {
  it.each([false, true, undefined])(
    "preserves a phase's active flag (%s) when renaming it",
    async (isActive) => {
      const fields = { ...backendPhase.draft, is_active: isActive };
      request.mockResolvedValue({
        ...backendPhase,
        draft: fields,
        released: fields,
      });
      const phase = await fetchTraegerPhase("7");

      expect(phase.draft.isActive).toBe(isActive);
      expect(phase.released?.isActive).toBe(isActive);

      await updateTraegerPhase(phase.id, {
        ...phase.draft,
        name: "Umbenannt",
        allSchools: phase.allSchools,
        schoolIds: ["11", "12"],
      });

      const [path, init] = request.mock.lastCall!;
      expect(path).toBe("/api/traeger/catalog/phases/7");
      expect(init.method).toBe("PUT");
      const body = JSON.parse(JSON.stringify(init.body));
      expect(body.name).toBe("Umbenannt");
      expect(body.is_active).toBe(isActive ?? null);
    },
  );

  it.each([false, true, undefined])(
    "preserves an offering's active flag (%s) when renaming it",
    async (isActive) => {
      const original = offeringWire;
      const draft = {
        ...original.draft,
        fields: { ...original.draft.fields, is_active: isActive },
      };
      const rawOffering = { ...original, draft, released: draft };
      request.mockResolvedValueOnce({
        ...backendPhase,
        offerings: [rawOffering],
      });
      const phase = await fetchTraegerPhase("7");
      const offering = phase.offerings[0]!;

      expect(offering.draft.fields.isActive).toBe(isActive);
      expect(offering.released?.fields.isActive).toBe(isActive);

      request.mockResolvedValueOnce(rawOffering);
      await updateTraegerOffering(offering.id, {
        ...offering.draft,
        fields: { ...offering.draft.fields, name: "Umbenannt" },
      });

      const [path, init] = request.mock.lastCall!;
      expect(path).toBe("/api/traeger/catalog/offerings/31");
      expect(init.method).toBe("PUT");
      const body = JSON.parse(JSON.stringify(init.body));
      expect(body.fields.name).toBe("Umbenannt");
      expect(body.fields.is_active).toBe(isActive ?? null);
    },
  );

  it("maps the phase and keeps a school's refusal code", async () => {
    request.mockResolvedValue(backendPhase);
    const phase = await fetchTraegerPhase("7");

    expect(request).toHaveBeenCalledWith("/api/traeger/catalog/phases/7");
    expect(phase.id).toBe("7");
    expect(phase.draft.audience).toBe("open");
    expect(phase.draft.careOverflowMode).toBe("waitlist");
    expect(phase.draft.careOfferingSelectionMode).toBe("optional");
    expect(phase.schools).toEqual([
      expect.objectContaining({
        schoolId: "11",
        outcome: "applied",
        errorCode: null,
      }),
      expect.objectContaining({
        schoolId: "12",
        outcome: "rejected",
        appliedVersion: null,
        errorCode: "enrollment.traeger_copy_rejected",
      }),
    ]);
    const offering = phase.offerings[0];
    expect(offering?.id).toBe("31");
    expect(offering?.draft.fields.selectionRule).toBe("optional");
    expect(offering?.draft.prices).toEqual([
      {
        weekday: "mon",
        daysPerWeek: null,
        monthlyCents: 650,
        siblingCents: 500,
        mealExtra: false,
      },
      {
        weekday: "tue",
        daysPerWeek: null,
        monthlyCents: 650,
        siblingCents: null,
        mealExtra: false,
      },
    ]);
    expect(offering?.draft.contractTemplate?.termMonths).toBeNull();
  });

  it("sends school IDs as numbers and none with „Alle Schulen“", async () => {
    request.mockResolvedValue(backendPhase);
    const input = {
      name: " Schuljahr ",
      kind: "school_year" as const,
      serviceStartDate: "2027-08-01",
      serviceEndDate: "2028-07-31",
      enrollmentOpenAt: null,
      enrollmentCloseAt: null,
      audience: "open" as const,
      careOverflowMode: "waitlist" as const,
      careOfferingSelectionMode: "optional" as const,
      allSchools: false,
      schoolIds: ["11", "12"],
    };
    await updateTraegerPhase("7", input);
    await updateTraegerPhase("7", { ...input, allSchools: true });

    const [first, second] = request.mock.calls.map(([, init]) => init.body);
    expect(first).toMatchObject({
      name: "Schuljahr",
      all_schools: false,
      school_ids: [11, 12],
    });
    expect(second).toMatchObject({ all_schools: true, school_ids: [] });
  });

  it("sends a scale price without weekday and leaves out an empty sibling price", async () => {
    request.mockResolvedValue(offeringWire);
    await createTraegerOffering("7", {
      fields: {
        name: "Ganztag",
        description: "  ",
        daysOfWeekMode: "parent_choice",
        availableDays: ["mon"],
        includesHolidayCare: false,
        includesLunch: true,
        capacity: null,
        priceCents: null,
        isRequired: false,
        countsAsCare: true,
        selectionGroup: "",
        selectionRule: "optional",
        sortOrder: 0,
        pickupTimes: { mon: "16:00" },
      },
      prices: [
        {
          weekday: null,
          daysPerWeek: 3,
          monthlyCents: 9000,
          siblingCents: null,
          mealExtra: true,
        },
      ],
      contractTemplate: null,
    });

    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe("/api/traeger/catalog/phases/7/offerings");
    expect(init.body.fields.description).toBeNull();
    expect(init.body.prices).toEqual([
      { days_per_week: 3, monthly_cents: 9000, meal_extra: true },
    ]);
    expect(init.body).not.toHaveProperty("contract_template");
  });

  it("reads the preview per school and confirms it with its fingerprint", async () => {
    request.mockResolvedValueOnce({
      traeger_phase_id: "7",
      version: 3,
      fingerprint: "abc",
      schools: [
        {
          school_id: "11",
          action: "update",
          outcome: "ready",
          care_beyond_end: 2,
          phase: [
            { field: "name", state: "keeps", traeger: "Neu", school: "Eigen" },
          ],
          offerings: [
            {
              traeger_offering_id: "31",
              name: "Frühbetreuung",
              action: "update",
              fields: null,
              prices_from: "2027-09-01",
              contract_template: false,
            },
          ],
        },
      ],
    } satisfies Preview);
    const preview = await previewTraegerPhase("7");
    expect(preview.schools[0]).toMatchObject({
      schoolId: "11",
      errorCode: null,
      careBeyondEnd: 2,
      phase: [
        { field: "name", state: "keeps", traeger: "Neu", school: "Eigen" },
      ],
      offerings: [
        { traegerOfferingId: "31", fields: [], pricesFrom: "2027-09-01" },
      ],
    });

    request.mockResolvedValueOnce({
      traeger_phase_id: "7",
      version: 3,
      schools: [{ school_id: "11", outcome: "stale", care_beyond_end: 0 }],
    } satisfies Rollout);
    const rollout = await rolloutTraegerPhase("7", preview.fingerprint);
    expect(request).toHaveBeenLastCalledWith(
      "/api/traeger/catalog/phases/7/rollout",
      {
        method: "POST",
        body: { fingerprint: "abc" },
      },
    );
    expect(rollout.schools).toEqual([
      { schoolId: "11", outcome: "stale", errorCode: null, careBeyondEnd: 0 },
    ]);
  });
});

function phaseWith(patch: (phase: PhaseDetail) => PhaseDetail): PhaseDetail {
  return patch(structuredClone(backendPhase));
}

// #2353: the editor saves what it read; nothing it does not know may be
// dropped, guessed or saved back.
describe("Träger catalog round trip (#2353)", () => {
  it("keeps a switched-off phase draft switched off when it is saved again", async () => {
    request.mockResolvedValue(
      phaseWith((phase) => ({
        ...phase,
        draft: { ...phase.draft, is_active: false },
      })),
    );
    const phase = await fetchTraegerPhase("7");
    await updateTraegerPhase("7", {
      ...phase.draft,
      allSchools: phase.allSchools,
      schoolIds: ["11"],
    });

    expect(request.mock.calls[1]![1].body.is_active).toBe(false);
  });

  it("keeps a switched-off offering draft switched off when it is saved again", async () => {
    request.mockResolvedValue(
      phaseWith((phase) => ({
        ...phase,
        offerings: [
          {
            ...offeringWire,
            draft: {
              ...offeringWire.draft,
              fields: { ...offeringWire.draft.fields, is_active: false },
            },
          },
        ],
      })),
    );
    const phase = await fetchTraegerPhase("7");
    request.mockResolvedValue(offeringWire);
    await updateTraegerOffering("31", phase.offerings[0]!.draft);

    expect(request.mock.calls[1]![1].body.fields.is_active).toBe(false);
  });

  it.each([
    ["kind", { kind: "trimester" }],
    ["audience", { audience: "" }],
    ["care_overflow_mode", { care_overflow_mode: "lottery" }],
  ])("fails the read of a phase draft with an unknown %s", async (_, patch) => {
    request.mockResolvedValue(
      phaseWith((phase) => ({ ...phase, draft: { ...phase.draft, ...patch } })),
    );
    await expect(fetchTraegerPhase("7")).rejects.toThrow(/unknown value/);
  });

  it.each([
    ["selection_rule", { selection_rule: "at_most_two" }],
    ["available_days", { available_days: ["mon", "holiday"] }],
  ])(
    "fails the read of an offering draft with an unknown %s",
    async (_, patch) => {
      request.mockResolvedValue(
        phaseWith((phase) => ({
          ...phase,
          offerings: [
            {
              ...offeringWire,
              draft: {
                ...offeringWire.draft,
                fields: { ...offeringWire.draft.fields, ...patch },
              },
            },
          ],
        })),
      );
      await expect(fetchTraegerPhase("7")).rejects.toThrow(/unknown value/);
    },
  );

  it("fails the read of a price on an unknown weekday", async () => {
    request.mockResolvedValue(
      phaseWith((phase) => ({
        ...phase,
        offerings: [
          {
            ...offeringWire,
            draft: {
              ...offeringWire.draft,
              prices: [
                { weekday: "hol", monthly_cents: 650, meal_extra: false },
              ],
            },
          },
        ],
      })),
    );
    await expect(fetchTraegerPhase("7")).rejects.toThrow(/unknown value/);
  });

  it("reads an unknown school outcome as unknown, not as one it knows", async () => {
    request.mockResolvedValue(
      phaseWith((phase) => ({
        ...phase,
        schools: [{ school_id: "11", selected: true, outcome: "superseded" }],
      })),
    );
    const phase = await fetchTraegerPhase("7");
    expect(phase.schools[0]?.outcome).toBeUndefined();
  });

  it("reads an unknown preview action, outcome and field state as unknown", async () => {
    request.mockResolvedValue({
      traeger_phase_id: "7",
      version: 3,
      fingerprint: "abc",
      schools: [
        {
          school_id: "11",
          action: "replace",
          outcome: "deferred",
          care_beyond_end: 0,
          phase: [
            { field: "name", state: "merged", traeger: "Neu", school: null },
          ],
          offerings: null,
        },
      ],
    } satisfies Preview);
    const preview = await previewTraegerPhase("7");
    expect(preview.schools[0]).toMatchObject({
      action: undefined,
      outcome: undefined,
      phase: [{ field: "name", state: undefined }],
      offerings: [],
    });
  });
});
