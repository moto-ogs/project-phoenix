import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { HolidayPeriod, TraegerSchool } from "~/lib/traeger-api";

const { mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("~/lib/traeger-api", () => ({
  createHolidayPeriod: (input: unknown) => mockCreate(input),
  updateHolidayPeriod: (id: string, input: unknown, version: string) =>
    mockUpdate(id, input, version),
}));

import { ExtraDayForm } from "./extra-day-form";

const schools: TraegerSchool[] = [
  { id: "31", name: "OGS Am Bach", slug: "bach", subdomain: "bach", city: "" },
  {
    id: "32",
    name: "OGS Lindenweg",
    slug: "linden",
    subdomain: "linden",
    city: "",
  },
];

// Friday 15 May 2099, far ahead of the test clock.
const stored: HolidayPeriod = {
  id: "7",
  kind: "extra_day",
  includedInFee: true,
  name: "Brückentag",
  registrationOpensOn: "2099-04-01",
  registrationClosesOn: "2099-05-01",
  binding: true,
  notes: "",
  holidayWishRule: false,
  status: "published",
  publishedAt: null,
  publicToken: "token",
  registrationCount: 1,
  version: "day-read",
  weeks: [
    {
      id: "71",
      startsOn: "2099-05-15",
      endsOn: "2099-05-15",
      hostSchoolId: "31",
      placed: 1,
      timeModels: [
        {
          id: "711",
          name: "Betreuung",
          startsAt: "07:30",
          endsAt: "16:00",
          priceCents: 0,
          protected: true,
        },
      ],
    },
  ],
};

function renderForm(period?: HolidayPeriod, onSaved = vi.fn()) {
  render(
    <ToastProvider>
      <ExtraDayForm
        period={period}
        schools={schools}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    </ToastProvider>,
  );
  return onSaved;
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value },
  });
}

describe("ExtraDayForm", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it("creates one day for the chosen schools, included in the monthly fee", async () => {
    mockCreate.mockResolvedValue({ ...stored, status: "draft" });
    const onSaved = renderForm();

    type("Name des Zusatztags", "Brückentag");
    type("Tag", "15.05.2099");
    fireEvent.click(screen.getByRole("checkbox", { name: "Alle Schulen" }));
    type(/Beginn/, "07:30");
    type(/Ende/, "16:00");
    type("Anmeldeschluss", "01.05.2099");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0] as {
      kind: string;
      includedInFee: boolean;
      weeks: {
        startsOn: string;
        endsOn: string;
        hostSchoolId: string;
        timeModels: { priceCents: number; startsAt: string }[];
      }[];
    };
    expect(input.kind).toBe("extra_day");
    expect(input.includedInFee).toBe(true);
    expect(input.weeks.map((week) => week.hostSchoolId)).toEqual(["31", "32"]);
    for (const week of input.weeks) {
      expect(week.startsOn).toBe("2099-05-15");
      expect(week.endsOn).toBe("2099-05-15");
      expect(week.timeModels[0]).toMatchObject({
        startsAt: "07:30",
        priceCents: 0,
      });
    }
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("asks for the price only with a day price and sends it for each school", async () => {
    mockCreate.mockResolvedValue({ ...stored, status: "draft" });
    renderForm();
    // Included: no price field, the screen says what parents see instead.
    expect(
      screen.queryByRole("textbox", { name: "Preis pro Tag in Euro" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Eltern sehen bei der Anmeldung keinen Preis/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Mit Tagespreis/ }));
    type("Name des Zusatztags", "Brückentag");
    type("Tag", "15.05.2099");
    fireEvent.click(screen.getByRole("checkbox", { name: "OGS Lindenweg" }));
    type(/Beginn/, "07:30");
    type(/Ende/, "16:00");
    type("Anmeldeschluss", "01.05.2099");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    // Without a price nothing is sent.
    expect(
      await screen.findByText(
        "Bitte gib einen Preis in Euro ein, zum Beispiel 18,00.",
      ),
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();

    type("Preis pro Tag in Euro", "18");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0] as {
      includedInFee: boolean;
      weeks: { hostSchoolId: string; timeModels: { priceCents: number }[] }[];
    };
    expect(input.includedInFee).toBe(false);
    expect(input.weeks).toHaveLength(1);
    expect(input.weeks[0]?.hostSchoolId).toBe("32");
    expect(input.weeks[0]?.timeModels[0]?.priceCents).toBe(1800);
  });

  it("names every missing field and sends nothing", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText("Bitte wähle mindestens eine Schule."),
    ).toBeInTheDocument();
    expect(screen.getByText("Bitte gib einen Namen ein.")).toBeInTheDocument();
    expect(screen.getByText("Bitte wähle den Tag.")).toBeInTheDocument();
    expect(screen.getByText("Bitte trage den Beginn ein.")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps a school with registrations chosen and saves over the read version", async () => {
    mockUpdate.mockResolvedValue({ ...stored, version: "day-saved" });
    renderForm(stored);

    const booked = await screen.findByRole("checkbox", {
      name: /OGS Am Bach/,
    });
    expect(booked).toBeChecked();
    expect(booked).toBeDisabled();
    expect(
      screen.getByText("Hat schon Anmeldungen und bleibt gewählt."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tag" })).toHaveValue(
      "15.05.2099",
    );

    // Parents registered under the fee of the published day: it stays.
    expect(
      screen.getByRole("radio", { name: /Mit Tagespreis/ }),
    ).toBeDisabled();
    expect(
      screen.getByText(/deshalb lässt er sich nicht mehr umstellen/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "OGS Lindenweg" }));
    fireEvent.click(
      screen.getByRole("switch", { name: /Mittagessen anbieten/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, input, version] = mockUpdate.mock.calls[0] as [
      string,
      {
        weeks: {
          id?: string;
          hostSchoolId: string;
          lunchPriceCents: number | null;
        }[];
      },
      string,
    ];
    expect(id).toBe("7");
    expect(version).toBe("day-read");
    // The stored day of the first school keeps its id, the new school has none.
    expect(input.weeks).toEqual([
      expect.objectContaining({ id: "71", hostSchoolId: "31" }),
      expect.objectContaining({ id: undefined, hostSchoolId: "32" }),
    ]);
    // Lunch on an included day costs nothing and is counted at each school.
    expect(input.weeks.map((week) => week.lunchPriceCents)).toEqual([0, 0]);
  });
});
