import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarAppointmentMails } from "~/lib/personal-calendar-api";

import {
  AppointmentMailStatus,
  appointmentMailNote,
} from "./appointment-mail-status";

const { mockGetStaffAppointmentMails } = vi.hoisted(() => ({
  mockGetStaffAppointmentMails: vi.fn(),
}));

vi.mock("~/lib/personal-calendar-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/personal-calendar-api")>()),
  getStaffAppointmentMails: mockGetStaffAppointmentMails,
}));

function renderStatus() {
  return render(<AppointmentMailStatus appointmentId="42" />);
}

const BOUNCED: CalendarAppointmentMails = {
  kinds: {
    appointment_published: { delivered: 11, undeliverable: 1 },
    appointment_updated: { delivered: 12 },
  },
  not_arrived: { appointment_published: ["Bernd Beispiel"] },
};

describe("AppointmentMailStatus", () => {
  beforeEach(() => {
    mockGetStaffAppointmentMails.mockReset();
  });

  it("shows each kind of mail with its results, the problem first, and whom to call", async () => {
    mockGetStaffAppointmentMails.mockResolvedValue(BOUNCED);
    renderStatus();

    const section = await screen.findByTestId("appointment-mails");
    expect(mockGetStaffAppointmentMails).toHaveBeenCalledWith("42");
    expect(
      within(section).getByRole("heading", { name: "E-Mails an die Eltern" }),
    ).toBeInTheDocument();
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Neuer Termin1 nicht zustellbar11 zugestellt",
      "Termin geändert12 zugestellt",
    ]);
    expect(
      within(section).getByText(
        "Nicht angekommen bei Bernd Beispiel. Bitte sagen Sie der Familie direkt Bescheid. Korrigieren Sie die Adresse beim Kind unter „Erziehungsberechtigte“.",
      ),
    ).toBeInTheDocument();
  });

  it("stays away while no mail went out", async () => {
    mockGetStaffAppointmentMails.mockResolvedValue({
      kinds: {},
      not_arrived: {},
    });
    const hidden = renderStatus();
    await waitFor(() =>
      expect(mockGetStaffAppointmentMails).toHaveBeenCalled(),
    );
    // The answer has arrived before the section is checked.
    await act(async () => {
      await mockGetStaffAppointmentMails.mock.results[0]?.value;
    });
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();

    mockGetStaffAppointmentMails.mockResolvedValue({
      ...BOUNCED,
      kinds: { appointment_reminder: { queued: 3 } },
      not_arrived: {},
    });
    renderStatus();
    // Anker: mit einer Mail erscheint derselbe Abschnitt.
    const section = await screen.findByTestId("appointment-mails");
    expect(within(section).getByText("Erinnerung")).toBeInTheDocument();
    expect(within(section).getByText("3 werden gesendet")).toBeInTheDocument();
    expect(section.querySelector("p")).toBeNull();
  });

  it("names the failed load instead of an empty section", async () => {
    mockGetStaffAppointmentMails.mockRejectedValue(new Error("offline"));
    renderStatus();

    const section = await screen.findByTestId("appointment-mails");
    expect(await within(section).findByRole("alert")).toBeInTheDocument();
  });
});

describe("appointmentMailNote", () => {
  it("lists every guardian once across kinds, in German order", () => {
    expect(
      appointmentMailNote({
        kinds: {
          appointment_published: { undeliverable: 2 },
          appointment_reminder: { send_failed: 1 },
        },
        not_arrived: {
          appointment_published: ["Özlem Yılmaz", "Anna Muster"],
          appointment_reminder: ["Anna Muster"],
        },
      }),
    ).toBe(
      "Nicht angekommen bei Anna Muster und Özlem Yılmaz. Bitte sagen Sie den Familien direkt Bescheid. Korrigieren Sie die Adresse beim Kind unter „Erziehungsberechtigte“.",
    );
  });

  it("points to the guardian card when no name matches the address any more", () => {
    expect(
      appointmentMailNote({
        kinds: {
          appointment_published: { undeliverable: 1, blocked: 1 },
          appointment_updated: { overdue: 1, delivered: 4 },
        },
      }),
    ).toBe(
      "3 Mails kamen nicht an. Welche Adresse betroffen ist, sehen Sie beim Kind unter „Erziehungsberechtigte“.",
    );
  });

  it("never reads a reported mail as one that did not arrive", () => {
    expect(
      appointmentMailNote({
        kinds: { appointment_published: { complained: 1, delivered: 3 } },
      }),
    ).toBe(
      "Eine Familie hat die Mail als unerwünscht gemeldet. Bitte sprechen Sie sie direkt an.",
    );
  });

  it("says that moto keeps trying a late mail, and nothing while all is fine", () => {
    expect(
      appointmentMailNote({ kinds: { appointment_updated: { delayed: 2 } } }),
    ).toBe("2 Mails kommen später an. moto versucht es weiter.");
    expect(
      appointmentMailNote({
        kinds: { appointment_published: { delivered: 3, accepted: 2 } },
      }),
    ).toBeNull();
    expect(appointmentMailNote(null)).toBeNull();
  });
});
