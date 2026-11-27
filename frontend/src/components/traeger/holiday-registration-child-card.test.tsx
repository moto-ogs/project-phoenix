import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { apiErrorFromBody } from "~/lib/api-error";
import { errorFromProblem } from "~/test/helpers/problem-response";
import type { HolidayRegistrationDetail } from "~/lib/traeger-holiday-registrations-api";
import {
  HOLIDAY_PERIOD,
  HOLIDAY_REGISTRATION,
  HOLIDAY_REGISTRATION_HEALTH,
} from "~/test/fixtures/holiday-registrations";
import { schoolNames } from "./holiday-registration-format";

const { mockRebook, mockRebookVersion } = vi.hoisted(() => ({
  mockRebook: vi.fn(),
  mockRebookVersion: vi.fn(),
}));

vi.mock("~/lib/traeger-holiday-registrations-api", () => ({
  // The version goes to its own spy: the rebooking sends the one it read.
  rebookHolidayChild: (...args: unknown[]) => {
    mockRebookVersion(args[4]);
    return mockRebook(...args.slice(0, 4));
  },
}));

import { catalogText } from "~/test/error-catalog-text";
import { HolidayRegistrationChildCard } from "./holiday-registration-child-card";

const names = schoolNames([
  { id: "31", name: "OGS Nord", slug: "nord", subdomain: "nord", city: "" },
  { id: "32", name: "OGS Süd", slug: "sued", subdomain: "sued", city: "" },
]);

function renderCard(
  registration: HolidayRegistrationDetail,
  childIndex: number,
  onChanged = vi.fn(),
  healthHidden = false,
  period = HOLIDAY_PERIOD,
) {
  const child = registration.children[childIndex]!;
  render(
    <ToastProvider>
      <HolidayRegistrationChildCard
        reload={vi.fn()}
        period={period}
        registration={registration}
        child={child}
        health={
          healthHidden
            ? undefined
            : HOLIDAY_REGISTRATION_HEALTH.children.find(
                (entry) => entry.childId === child.id,
              )
        }
        healthHidden={healthHidden}
        names={names}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return onChanged;
}

describe("HolidayRegistrationChildCard", () => {
  beforeEach(() => {
    mockRebook.mockReset();
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", "traeger.localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  // Whoever reads the Gesundheit box before the holiday week must not miss
  // an intolerance the form asked for: health answers stand there.
  it("puts the answers to health questions into the Gesundheit box", () => {
    renderCard(
      {
        ...HOLIDAY_REGISTRATION,
        form: {
          version: 2,
          fields: [
            {
              key: "unvertraeglich",
              label: "Lebensmittelunverträglichkeiten",
              type: "text",
              applies_to_child: true,
              health: true,
              sort_order: 0,
            },
            {
              key: "ausfluege",
              label: "Darf an Ausflügen teilnehmen",
              type: "boolean",
              applies_to_child: true,
              sort_order: 1,
            },
          ],
        },
        childAnswers: { "9": { unvertraeglich: "Laktose", ausfluege: true } },
      },
      0,
    );

    const healthBox = within(
      screen.getByRole("heading", { name: "Gesundheit" }).parentElement!,
    );
    expect(healthBox.getByText("Erdnüsse")).toBeInTheDocument();
    expect(
      healthBox.getByText("Lebensmittelunverträglichkeiten"),
    ).toBeInTheDocument();
    expect(healthBox.getByText("Laktose")).toBeInTheDocument();
    const otherBox = within(
      screen.getByRole("heading", { name: "Weitere Angaben" }).parentElement!,
    );
    expect(
      otherBox.getByText("Darf an Ausflügen teilnehmen"),
    ).toBeInTheDocument();
    expect(otherBox.queryByText("Laktose")).not.toBeInTheDocument();
  });

  it("shows school, weeks, health information and the duplicate hint", () => {
    renderCard(HOLIDAY_REGISTRATION, 0);

    expect(screen.getByText("Lia Muster")).toBeInTheDocument();
    expect(
      screen.getByText("Geboren am 01.03.2018, OGS Nord"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("04.01. bis 08.01.2027: bis 16 Uhr, OGS Nord"),
    ).toBeInTheDocument();
    expect(screen.getByText("Erdnüsse")).toBeInTheDocument();
    expect(
      screen.getByText(/Vielleicht doppelt angemeldet\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Anmeldung Nr. 8 öffnen" }),
    ).toHaveAttribute("href", "/traeger/ferien/5/anmeldungen/8");
  });

  it("says who sees the health information instead of showing it (#4722)", () => {
    renderCard(HOLIDAY_REGISTRATION, 0, vi.fn(), true);

    // Anker: die Karte ist geladen und sagt, wer die Angaben sieht.
    expect(
      screen.getByText("Gesundheitsangaben sieht nur die Rolle Verwaltung."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Erdnüsse")).not.toBeInTheDocument();
  });

  it("names a holiday guest with its school", () => {
    renderCard(HOLIDAY_REGISTRATION, 1);

    expect(
      screen.getByText("Geboren am 12.09.2016, Feriengast (Grundschule Melle)"),
    ).toBeInTheDocument();
  });

  it("rebooks a child week by week", async () => {
    const rebooked = { ...HOLIDAY_REGISTRATION, history: [] };
    mockRebook.mockResolvedValue(rebooked);
    const onChanged = renderCard(HOLIDAY_REGISTRATION, 1);

    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 04.01. bis 08.01.2027, OGS Nord",
      }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "bis 16 Uhr" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(rebooked));
    expect(mockRebookVersion).toHaveBeenCalledWith("registration-read");
    expect(mockRebook).toHaveBeenCalledWith("5", "7", "10", [
      { weekId: "51", timeModelId: "62" },
      { weekId: "52", timeModelId: "63" },
    ]);
  });

  it("toggles lunch only for the labelled child when two editors share a week", () => {
    const period = {
      ...HOLIDAY_PERIOD,
      weeks: [{ ...HOLIDAY_PERIOD.weeks[0]!, lunchPriceCents: 430 }],
    };
    const registration = {
      ...HOLIDAY_REGISTRATION,
      children: HOLIDAY_REGISTRATION.children.map((child) => ({
        ...child,
        bookings: [{ ...HOLIDAY_REGISTRATION.children[0]!.bookings[0]! }],
      })),
    };
    renderCard(registration, 0, vi.fn(), false, period);
    renderCard(registration, 1, vi.fn(), false, period);
    for (const button of screen.getAllByRole("button", { name: "Umbuchen" })) {
      fireEvent.click(button);
    }

    const [first, second] = screen.getAllByRole("checkbox", {
      name: /Mit Mittagessen/,
    });
    const labels = screen.getAllByText("Mit Mittagessen");
    fireEvent.click(labels[1]!);

    expect(second).toBeChecked();
    expect(first).not.toBeChecked();
    const saves = screen.getAllByRole("button", { name: "Speichern" });
    expect(saves[0]).toBeDisabled();
    expect(saves[1]).toBeEnabled();
  });

  it("keeps a child in at least one week", async () => {
    renderCard(HOLIDAY_REGISTRATION, 1);

    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 11.01. bis 15.01.2027, OGS Süd",
      }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "Nicht angemeldet" }),
    );

    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  // ADR 0311: a registration changed since the rebooking opened is refused;
  // the message stays as a toast while the card reads the stored weeks and
  // closes the rebooking, and nothing is sent again.
  it("reads the stored weeks again after a registration changed since", async () => {
    mockRebook.mockRejectedValue(
      apiErrorFromBody("changed", 409, {
        status: 409,
        code: "general.changed_since_read",
        detail: "changed since it was read",
      }),
    );
    const reload = vi.fn().mockResolvedValue(undefined);
    const child = HOLIDAY_REGISTRATION.children[1]!;
    render(
      <ToastProvider>
        <HolidayRegistrationChildCard
          reload={reload}
          period={HOLIDAY_PERIOD}
          registration={HOLIDAY_REGISTRATION}
          child={child}
          health={undefined}
          names={names}
          onChanged={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 04.01. bis 08.01.2027, OGS Nord",
      }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "bis 16 Uhr" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Wochen des Kindes"),
      ),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Umbuchen" }),
      ).toBeInTheDocument(),
    );
    expect(mockRebook).toHaveBeenCalledTimes(1);
  });

  it.each(["Feiertag", "Betriebsausflug"])(
    "shows the calendar reason %s and the next step after a refused rebooking",
    async (name) => {
      mockRebook.mockRejectedValue(
        await errorFromProblem("calendar refusal", 409, {
          code: "enrollment.holiday_week_no_care_day",
          detail: "Internal calendar diagnostics",
          details: {
            week: 1,
            week_id: "22",
            date: "04.01.2027",
            iso_date: "2027-01-04",
            kind: "closure",
            name,
          },
        }),
      );
      const onChanged = renderCard(HOLIDAY_REGISTRATION, 1);
      fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
      fireEvent.click(
        screen.getByRole("combobox", {
          name: "Zeitmodell 04.01. bis 08.01.2027, OGS Nord",
        }),
      );
      fireEvent.click(
        await screen.findByRole("option", { name: "bis 16 Uhr" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Am 04.01.2027 gibt es keine Betreuung (${name}). Diese Woche kann man nicht buchen. Wähle eine andere Woche.`,
      );
      expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
      expect(onChanged).not.toHaveBeenCalled();
    },
  );

  it("moves a child to the parallel week of another school (#5689)", async () => {
    mockRebook.mockResolvedValue(HOLIDAY_REGISTRATION);
    const [first, second] = HOLIDAY_PERIOD.weeks;
    const parallel = {
      ...HOLIDAY_PERIOD,
      weeks: [
        first!,
        { ...second!, startsOn: first!.startsOn, endsOn: first!.endsOn },
      ],
    };
    renderCard(HOLIDAY_REGISTRATION, 1, vi.fn(), false, parallel);

    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 04.01. bis 08.01.2027",
      }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "OGS Nord: bis 16 Uhr" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockRebook).toHaveBeenCalledWith("5", "7", "10", [
        { weekId: "51", timeModelId: "62" },
      ]),
    );
  });

  it("refuses weeks that share only some days (#5689)", async () => {
    const [first, second] = HOLIDAY_PERIOD.weeks;
    const partly = {
      ...HOLIDAY_PERIOD,
      weeks: [first!, { ...second!, startsOn: first!.endsOn }],
    };
    renderCard(HOLIDAY_REGISTRATION, 1, vi.fn(), false, partly);

    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 04.01. bis 08.01.2027, OGS Nord",
      }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "bis 16 Uhr" }));

    expect(
      screen.getByText(
        "Zwei dieser Wochen überschneiden sich. Bitte wähle nur eine davon.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("says how a frozen registration is rebooked", () => {
    renderCard({ ...HOLIDAY_REGISTRATION, frozen: true }, 0);

    expect(
      screen.getByText("Zum Umbuchen öffnest du die Anmeldung zuerst wieder."),
    ).toBeInTheDocument();
    expect(screen.getByText("Lia Muster")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Umbuchen" })).toBeNull();
  });
  it("can reselect a saved day that has since closed", () => {
    const child = HOLIDAY_REGISTRATION.children[0]!;
    const registration = {
      ...HOLIDAY_REGISTRATION,
      children: [
        {
          ...child,
          bookings: [
            { ...child.bookings[0]!, days: ["2027-01-04", "2027-01-05"] },
          ],
        },
      ],
    };
    const period = {
      ...HOLIDAY_PERIOD,
      weeks: [
        {
          ...HOLIDAY_PERIOD.weeks[0]!,
          bookingUnit: "day" as const,
          noCareDays: [
            {
              date: "2027-01-04",
              kind: "closing_day" as const,
              name: "Teamtag",
            },
          ],
        },
      ],
    };
    renderCard(registration, 0, vi.fn(), false, period);
    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    const monday = screen.getByRole("button", { name: "Mo 04.01." });
    expect(monday).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(monday);
    expect(screen.getByRole("button", { name: "Mo 04.01." })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Mo 04.01." }));
    expect(screen.getByRole("button", { name: "Mo 04.01." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("can restore a saved booking on a closed week after changing the draft", async () => {
    const period = {
      ...HOLIDAY_PERIOD,
      weeks: HOLIDAY_PERIOD.weeks.map((week) => ({
        ...week,
        noCareDays: [
          {
            date: week.startsOn,
            kind: "closing_day" as const,
            name: "Brückentag",
          },
        ],
      })),
    };
    renderCard(HOLIDAY_REGISTRATION, 1, vi.fn(), false, period);
    fireEvent.click(screen.getByRole("button", { name: "Umbuchen" }));
    const select = screen.getByRole("combobox", {
      name: "Zeitmodell 11.01. bis 15.01.2027, OGS Süd",
    });
    fireEvent.click(select);
    fireEvent.click(
      await screen.findByRole("option", { name: "Nicht angemeldet" }),
    );
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: "bis 13 Uhr" }));
    expect(select).toHaveTextContent("bis 13 Uhr");
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Zeitmodell 04.01. bis 08.01.2027, OGS Nord",
      }),
    );
    expect(
      await screen.findByRole("option", { name: "Nicht angemeldet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "bis 16 Uhr" }),
    ).not.toBeInTheDocument();
  });
});
