import { describe, expect, it } from "vitest";
import type { HolidayPeriod } from "~/lib/traeger-api";
import {
  draftFromExtraDay,
  emptyExtraDay,
  type ExtraDayDraft,
  extraDayCareTime,
  extraDayFee,
  extraDayNoCare,
  extraDayServerFields,
  extraDayPlaced,
  extraDaysOf,
  inputFromExtraDay,
  validateExtraDay,
} from "./extra-day-model";

// Friday 15 May 2026, the day after Christi Himmelfahrt.
function bridgeDay(): ExtraDayDraft {
  return {
    ...emptyExtraDay("2026-04-01"),
    name: " Brückentag ",
    date: "2026-05-15",
    schoolIds: ["31", "32"],
    startsAt: "07:30",
    endsAt: "16:00",
    registrationClosesOn: "2026-05-01",
  };
}

function storedDay(overrides: Partial<HolidayPeriod> = {}): HolidayPeriod {
  return {
    id: "7",
    kind: "extra_day",
    includedInFee: false,
    name: "Brückentag",
    registrationOpensOn: "2026-04-01",
    registrationClosesOn: "2026-05-01",
    binding: true,
    notes: "",
    holidayWishRule: false,
    status: "published",
    publishedAt: null,
    publicToken: "token",
    registrationCount: 3,
    version: "v1",
    weeks: [
      {
        id: "71",
        startsOn: "2026-05-15",
        endsOn: "2026-05-15",
        hostSchoolId: "31",
        placed: 2,
        timeModels: [
          {
            id: "711",
            name: "Betreuung",
            startsAt: "07:30",
            endsAt: "16:00",
            priceCents: 1800,
          },
        ],
      },
      {
        id: "72",
        startsOn: "2026-05-15",
        endsOn: "2026-05-15",
        hostSchoolId: "32",
        placed: 1,
        timeModels: [
          {
            id: "721",
            name: "Betreuung",
            startsAt: "07:30",
            endsAt: "16:00",
            priceCents: 1800,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("extra day model", () => {
  it("sends one single-day week per school, without a price when included", () => {
    const input = inputFromExtraDay(bridgeDay());
    expect(input.kind).toBe("extra_day");
    expect(input.includedInFee).toBe(true);
    expect(input.name).toBe("Brückentag");
    expect(input.weeks).toHaveLength(2);
    for (const week of input.weeks) {
      expect(week.startsOn).toBe("2026-05-15");
      expect(week.endsOn).toBe("2026-05-15");
      expect(week.bookingUnit).toBe("week");
      expect(week.timeModels).toEqual([
        {
          id: undefined,
          name: "Betreuung",
          startsAt: "07:30",
          endsAt: "16:00",
          priceCents: 0,
        },
      ]);
    }
    expect(input.weeks.map((week) => week.hostSchoolId)).toEqual(["31", "32"]);
  });

  it("prices each school's day at the day price", () => {
    const input = inputFromExtraDay({
      ...bridgeDay(),
      feeMode: "day_price",
      price: "18",
    });
    expect(input.includedInFee).toBe(false);
    expect(input.weeks.map((week) => week.timeModels[0]?.priceCents)).toEqual([
      1800, 1800,
    ]);
  });

  it("keeps the stored day of a school, so its bookings stay", () => {
    const stored = storedDay();
    const draft = { ...draftFromExtraDay(stored), schoolIds: ["32", "33"] };
    const input = inputFromExtraDay(draft, stored);
    expect(input.weeks.map((week) => week.id)).toEqual(["72", undefined]);
    expect(input.weeks[0]?.timeModels[0]?.id).toBe("721");
    expect(input.weeks[1]?.timeModels[0]?.id).toBeUndefined();
  });

  it("reads the stored day back into the form", () => {
    expect(draftFromExtraDay(storedDay())).toMatchObject({
      date: "2026-05-15",
      schoolIds: ["31", "32"],
      startsAt: "07:30",
      endsAt: "16:00",
      feeMode: "day_price",
      price: "18,00",
    });
    expect(draftFromExtraDay(storedDay({ includedInFee: true }))).toMatchObject(
      { feeMode: "included", price: "" },
    );
  });

  it("accepts a complete day", () => {
    expect(validateExtraDay(bridgeDay())).toEqual({});
  });

  it("names what a day is missing", () => {
    expect(validateExtraDay(emptyExtraDay("2026-04-01"))).toEqual({
      name: "Bitte gib einen Namen ein.",
      date: "Bitte wähle den Tag.",
      schools: "Bitte wähle mindestens eine Schule.",
      starts_at: "Bitte trage den Beginn ein.",
      ends_at: "Bitte trage das Ende ein.",
      registration_closes_on: "Bitte wähle den Anmeldeschluss.",
    });
  });

  it("refuses a weekend, a late deadline and a missing day price", () => {
    expect(validateExtraDay({ ...bridgeDay(), date: "2026-05-16" }).date).toBe(
      "Ein Zusatztag liegt auf einem Tag von Montag bis Freitag.",
    );
    expect(
      validateExtraDay({ ...bridgeDay(), registrationClosesOn: "2026-05-16" })
        .registration_closes_on,
    ).toBe("Der Anmeldeschluss liegt nach dem Zusatztag.");
    expect(validateExtraDay({ ...bridgeDay(), endsAt: "07:00" }).ends_at).toBe(
      "Das Ende liegt nicht nach dem Beginn.",
    );
    expect(
      validateExtraDay({ ...bridgeDay(), feeMode: "day_price", price: "" })
        .price,
    ).toBe("Bitte gib einen Preis in Euro ein, zum Beispiel 18,00.");
    expect(
      validateExtraDay({ ...bridgeDay(), feeMode: "day_price", price: "0" })
        .price,
    ).toContain("Im Monatsbeitrag enthalten");
  });

  it("leads a refused field of the backend to its control", () => {
    expect(extraDayServerFields("date", 2)).toEqual([
      "weeks.0.starts_on",
      "weeks.0.ends_on",
      "weeks.1.starts_on",
      "weeks.1.ends_on",
    ]);
    expect(extraDayServerFields("schools", 1)).toContain(
      "weeks.0.host_school_id",
    );
    expect(extraDayServerFields("price", 1)).toContain(
      "weeks.0.time_models.0.price_cents",
    );
    expect(extraDayServerFields("name", 3)).toEqual(["name"]);
  });

  it("names the chosen schools without care on the day", () => {
    const calendar = {
      schools: [
        {
          id: "31",
          name: "Nord",
          federalStateCode: "DE-NW",
          federalStateName: "NRW",
        },
        {
          id: "32",
          name: "Süd",
          federalStateCode: "DE-NW",
          federalStateName: "NRW",
        },
      ],
      regions: [
        {
          code: "DE-NW",
          name: "NRW",
          holidays: [{ date: "2026-05-14", name: "Christi Himmelfahrt" }],
        },
      ],
      closingDays: [
        {
          id: "1",
          startDate: "2026-05-15",
          endDate: "2026-05-15",
          reason: "Brückentag",
          schoolIds: ["32"],
          version: "v",
        },
      ],
    };
    expect(extraDayNoCare("2026-05-14", ["31"], calendar)).toEqual([
      { schoolId: "31", kind: "holiday", name: "Christi Himmelfahrt" },
    ]);
    expect(extraDayNoCare("2026-05-15", ["31", "32"], calendar)).toEqual([
      { schoolId: "32", kind: "closing_day", name: "Brückentag" },
    ]);
    expect(extraDayNoCare("2026-05-18", ["31", "32"], calendar)).toEqual([]);
  });

  it("shows fee, care time and the children of all schools", () => {
    const day = storedDay();
    // Intl puts a no-break space before the euro sign.
    expect(extraDayFee(day)).toBe("18,00\u00a0€ pro Tag");
    expect(extraDayFee(storedDay({ includedInFee: true }))).toBe(
      "Im Monatsbeitrag enthalten",
    );
    expect(extraDayCareTime(day)).toBe("07:30 bis 16:00 Uhr");
    expect(extraDayPlaced(day)).toBe(3);
  });

  it("lists only extra days, the next day first", () => {
    const later = storedDay({ id: "9" });
    const sooner = storedDay({
      id: "8",
      weeks: [{ ...storedDay().weeks[0]!, startsOn: "2026-05-04" }],
    });
    const holidays = storedDay({ id: "1", kind: "holiday" });
    expect(
      extraDaysOf([later, holidays, sooner]).map((period) => period.id),
    ).toEqual(["8", "9"]);
  });
});
