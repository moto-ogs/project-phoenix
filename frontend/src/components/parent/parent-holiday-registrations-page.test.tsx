import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import deMessages from "~/i18n/messages/de.generated";
import { ApiError } from "~/lib/api-error";
import {
  listHolidayRegistrationEntries,
  setHolidayRegistrationConsent,
} from "~/lib/parent-api";
import {
  holidayRegistrationEntriesFromBackend,
  type HolidayRegistrationEntry,
} from "~/lib/parent-holiday-registration-entries";
import { IsolatedSWRCache } from "~/lib/swr";
import { catalogText } from "~/test/error-catalog-text";
import { PARENT_HOLIDAY_REGISTRATION_ENTRIES } from "~/test/fixtures/holiday-registrations";
import { ParentHolidayRegistrationsPage } from "./parent-holiday-registrations-page";

vi.unmock("next-intl");
vi.unmock("swr");
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantSafe: () => null,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "parent-test", scope: "parent" } },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/parent-api", () => ({
  listHolidayRegistrationEntries: vi.fn(),
  setHolidayRegistrationConsent: vi.fn(),
}));

const mockedEntries = vi.mocked(listHolidayRegistrationEntries);
const mockedSetConsent = vi.mocked(setHolidayRegistrationConsent);
const ENTRIES = holidayRegistrationEntriesFromBackend(
  PARENT_HOLIDAY_REGISTRATION_ENTRIES,
);

function renderPage() {
  return render(
    <IsolatedSWRCache>
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <ToastProvider>
          <ParentHolidayRegistrationsPage />
        </ToastProvider>
      </NextIntlClientProvider>
    </IsolatedSWRCache>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParentHolidayRegistrationsPage (#6673)", () => {
  it("shows every registration with its state, the weeks and who acts next", async () => {
    mockedEntries.mockResolvedValue(ENTRIES);
    renderPage();

    const received = await screen.findByRole("region", {
      name: "Weihnachtsferien 2026/27",
    });
    expect(within(received).getByText("Eingegangen")).toBeInTheDocument();
    expect(
      within(received).getByText(
        "Träger Bissendorf · 04.01.2027 bis 08.01.2027",
      ),
    ).toBeInTheDocument();
    expect(
      within(received).getByText("Eingegangen am 08.09.2026"),
    ).toBeInTheDocument();
    expect(
      within(received).getByText(
        "Der Träger prüft deine Anmeldung und schreibt dir.",
      ),
    ).toBeInTheDocument();
    expect(
      within(received).getByRole("heading", { name: "Mia" }),
    ).toBeInTheDocument();
    expect(
      within(received).getByText("04.01.2027 bis 08.01.2027 · bis 16 Uhr"),
    ).toBeInTheDocument();
    // The same words as the receipt after sending (#4699).
    expect(within(received).getByText("Warteliste")).toBeInTheDocument();
    expect(
      within(received).getByText(/dort steht dein Kind auf der Warteliste/i),
    ).toBeInTheDocument();
    // Anker: the received card is rendered; it has no way to the documents.
    expect(
      within(received).queryByRole("link", { name: "Zu den Dokumenten" }),
    ).not.toBeInTheDocument();

    const confirmed = screen.getByRole("region", { name: "Herbstferien 2026" });
    expect(within(confirmed).getByText("Bestätigt")).toBeInTheDocument();
    expect(within(confirmed).getAllByText("Platz reserviert")).toHaveLength(2);
    expect(
      within(confirmed).getByRole("heading", { name: "Ben" }),
    ).toBeInTheDocument();
    expect(
      within(confirmed).getByRole("link", { name: "Zu den Dokumenten" }),
    ).toHaveAttribute("href", "/documents");

    const cancelled = screen.getByRole("region", { name: "Sommerferien 2026" });
    expect(within(cancelled).getByText("Storniert")).toBeInTheDocument();
    // Anker: the cancelled card lists its week, without a place that no
    // longer counts.
    expect(
      within(cancelled).getByText("20.07.2026 bis 24.07.2026 · bis 16 Uhr"),
    ).toBeInTheDocument();
    expect(within(cancelled).queryByText("Warteliste")).not.toBeInTheDocument();
  });

  it("explains where registrations come from when there is none, without a create button", async () => {
    mockedEntries.mockResolvedValue([]);
    renderPage();

    // Anker: the empty state of the loaded page names where entries come from.
    expect(
      await screen.findByText(/Noch keine Ferienanmeldungen/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/mit der E-Mail-Adresse dieses Kontos an/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a failed load with a retry that loads again", async () => {
    mockedEntries.mockRejectedValueOnce(
      new ApiError("boom", 500, { code: "general.server" }),
    );
    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.server", "Deine Ferienanmeldungen"),
        { exact: false },
      ),
    ).toBeInTheDocument();
    mockedEntries.mockResolvedValueOnce(ENTRIES);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(
      await screen.findByRole("region", { name: "Herbstferien 2026" }),
    ).toBeInTheDocument();
  });

  describe("voluntary consents (#8038)", () => {
    const photos = {
      key: "fotos",
      title: "Fotos in der Ferienbetreuung",
      label: "Mein Kind darf auf Erinnerungsfotos zu sehen sein.",
      text: "Die Fotos bleiben in der OGS.",
    };
    const trips = {
      key: "ausfluege",
      title: "Ausflüge mit dem Bus",
      label: "Mein Kind darf mit dem Bus fahren.",
      text: "",
    };
    const withConsents = (
      given: boolean,
      changedAt: string | null,
    ): HolidayRegistrationEntry[] => [
      {
        ...ENTRIES[0]!,
        consents: [
          { ...photos, given, changedAt },
          { ...trips, given: false, changedAt: null },
        ],
      },
    ];

    it("lists each consent in its words with its state and withdraws one after asking", async () => {
      mockedEntries.mockResolvedValueOnce(
        withConsents(true, "2026-09-08T08:00:00Z"),
      );
      renderPage();

      const card = await screen.findByRole("region", {
        name: "Weihnachtsferien 2026/27",
      });
      expect(
        within(card).getByRole("heading", { name: "Einwilligungen" }),
      ).toBeInTheDocument();
      expect(within(card).getByText(photos.label)).toBeInTheDocument();
      expect(within(card).getByText(photos.text)).toBeInTheDocument();
      expect(within(card).getByText("Seit 08.09.2026")).toBeInTheDocument();
      expect(within(card).getByText("Erteilt")).toBeInTheDocument();
      expect(within(card).getByText("Nicht erteilt")).toBeInTheDocument();
      expect(
        within(card).getByText("Du hast sie bei der Anmeldung nicht gegeben."),
      ).toBeInTheDocument();

      mockedSetConsent.mockResolvedValueOnce();
      mockedEntries.mockResolvedValueOnce(
        withConsents(false, "2026-09-09T10:00:00Z"),
      );
      fireEvent.click(
        within(card).getByRole("button", {
          name: "Einwilligung „Fotos in der Ferienbetreuung“ widerrufen",
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Einwilligung widerrufen?",
      });
      expect(within(dialog).getByText(photos.label)).toBeInTheDocument();
      expect(within(dialog).getByText(/sieht ihn sofort/)).toBeInTheDocument();
      expect(mockedSetConsent).not.toHaveBeenCalled();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Widerrufen" }),
      );

      expect(
        await screen.findByText(
          "Du hast die Einwilligung „Fotos in der Ferienbetreuung“ widerrufen.",
        ),
      ).toBeInTheDocument();
      expect(mockedSetConsent).toHaveBeenCalledWith("12", "fotos", false);
      expect(mockedEntries).toHaveBeenCalledTimes(2);
      expect(
        within(card).getByText("Du hast sie am 09.09.2026 widerrufen."),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", {
          name: "Einwilligung „Fotos in der Ferienbetreuung“ geben",
        }),
      ).toBeInTheDocument();
    });

    it("keeps a failed change in the open dialog with a retry", async () => {
      mockedEntries.mockResolvedValue(withConsents(false, null));
      renderPage();
      const card = await screen.findByRole("region", {
        name: "Weihnachtsferien 2026/27",
      });
      mockedSetConsent.mockRejectedValueOnce(
        new ApiError("gone", 404, {
          code: "enrollment.holiday_registration_entry_not_found",
        }),
      );
      fireEvent.click(
        within(card).getByRole("button", {
          name: "Einwilligung „Ausflüge mit dem Bus“ geben",
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Einwilligung geben?",
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Einwilligung geben" }),
      );
      expect(
        await within(dialog).findByText(
          catalogText(
            "enrollment.holiday_registration_entry_not_found",
            "Die Einwilligung",
          ),
          { exact: false },
        ),
      ).toBeInTheDocument();
      expect(mockedSetConsent).toHaveBeenCalledWith("12", "ausfluege", true);
    });
  });
});
