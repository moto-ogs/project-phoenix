import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ToastProvider } from "~/contexts/ToastContext";
import type { HolidayPeriod } from "~/lib/traeger-api";

const { mockPublish } = vi.hoisted(() => ({ mockPublish: vi.fn() }));

vi.mock("~/lib/traeger-api", () => ({
  publishHolidayPeriod: (id: string) => mockPublish(id),
}));

import {
  HolidayPeriodPublishButton,
  HolidayPeriodPublishCard,
} from "./holiday-period-publish-card";

const renderCard = (card: ReactElement) =>
  render(<ToastProvider>{card}</ToastProvider>);

const complete: HolidayPeriod = {
  id: "5",
  name: "Osterferien",
  registrationOpensOn: "2027-01-11",
  registrationClosesOn: "2027-02-26",
  binding: true,
  holidayWishRule: false,
  notes: "",
  status: "draft",
  publishedAt: null,
  publicToken: "abc123",
  registrationCount: 0,
  weeks: [
    {
      id: "7",
      startsOn: "2027-03-22",
      endsOn: "2027-03-26",
      hostSchoolId: "31",
      timeModels: [
        {
          id: "9",
          name: "bis 13 Uhr",
          startsAt: "08:00",
          endsAt: "13:00",
          priceCents: 4500,
        },
      ],
    },
  ],
};

describe("HolidayPeriodPublishButton", () => {
  beforeEach(() => {
    mockPublish.mockReset();
  });

  it("blocks publishing and the card names what is missing", () => {
    const period = { ...complete, weeks: [] };
    renderCard(
      <>
        <HolidayPeriodPublishButton
          period={period}
          unsavedChanges={false}
          onPublished={vi.fn()}
        />
        <HolidayPeriodPublishCard period={period} unsavedChanges={false} />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Veröffentlichen" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(/braucht der Ferienzeitraum mindestens eine Woche/, {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("asks to save unsaved changes first", () => {
    renderCard(
      <>
        <HolidayPeriodPublishButton
          period={complete}
          unsavedChanges
          onPublished={vi.fn()}
        />
        <HolidayPeriodPublishCard period={complete} unsavedChanges />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Veröffentlichen" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Bitte speichere zuerst deine Änderungen.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("publishes a complete period after the confirmation", async () => {
    const onPublished = vi.fn();
    mockPublish.mockResolvedValue({
      ...complete,
      status: "published",
      publishedAt: "2026-10-25T09:00:00Z",
    });
    renderCard(
      <HolidayPeriodPublishButton
        period={complete}
        unsavedChanges={false}
        onPublished={onPublished}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Veröffentlichen" }));
    expect(mockPublish).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Veröffentlichen" }),
    );

    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith("5"));
    await waitFor(() =>
      expect(onPublished).toHaveBeenCalledWith(
        expect.objectContaining({ status: "published" }),
      ),
    );
  });

  it("offers nothing once the period is published", () => {
    renderCard(
      <>
        <p>Kopf</p>
        <HolidayPeriodPublishButton
          period={{ ...complete, status: "published" }}
          unsavedChanges={false}
          onPublished={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText("Kopf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("HolidayPeriodPublishCard", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PARENTS_HOSTNAME", "parents.localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows since when a published period is open for registration", () => {
    renderCard(
      <HolidayPeriodPublishCard
        period={{
          ...complete,
          status: "published",
          publishedAt: "2026-10-25T09:00:00Z",
        }}
        unsavedChanges={false}
      />,
    );
    expect(
      screen.getByText(/Seit 25\.10\.2026 für die Anmeldung freigegeben\./),
    ).toBeInTheDocument();
    // The only controls left hand the parents' link on: copy it (#4661) or
    // show it as a QR code.
    // Zugängliche Namen statt textContent: die Knopf-Erklärung (#6643) liegt
    // als versteckte Beschreibung im Knopf.
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Link kopieren" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QR-Code" })).toBeInTheDocument();
    // The title names the link, not the status: the head shows the status
    // (#7411).
    expect(
      screen.getByRole("heading", { name: "Link für Eltern" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Veröffentlicht")).toBeNull();
  });

  it("shows the one link for parents", () => {
    renderCard(
      <HolidayPeriodPublishCard
        period={{
          ...complete,
          status: "published",
          publishedAt: "2026-10-25T09:00:00Z",
          registrationCount: 3,
        }}
        unsavedChanges={false}
      />,
    );
    expect(
      screen.getByText("http://parents.localhost:3000/ferienanmeldung/abc123"),
    ).toBeInTheDocument();
    // The count and the way to the registrations live in the tab
    // „Anmeldungen“ (#7411).
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("tells a draft that the link for parents comes with publishing", () => {
    renderCard(
      <HolidayPeriodPublishCard period={complete} unsavedChanges={false} />,
    );
    expect(
      screen.getByText("Den Link für Eltern gibt es nach dem Veröffentlichen."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ferienanmeldung/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
