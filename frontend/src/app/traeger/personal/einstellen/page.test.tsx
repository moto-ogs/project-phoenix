import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { StaffOverview, StaffRecordDetail } from "~/lib/traeger-staff-api";
import TraegerStaffHirePage from "./page";

const api = vi.hoisted(() => ({
  fetchStaffOverview: vi.fn(),
  hireStaff: vi.fn(),
}));
vi.mock("~/lib/traeger-staff-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const OVERVIEW: StaffOverview = {
  release: { representation: "agreement", releasedAt: "2026-11-13T09:00:00Z" },
  schools: [
    { id: "1", name: "OGS Nord" },
    { id: "2", name: "OGS Süd" },
  ],
  records: [],
  suggestions: [],
};

const HIRED = {
  id: "9",
  firstName: "Lena",
  lastName: "Brandt",
  employments: [
    { schoolId: "1", schoolName: "OGS Nord", staffId: "41", active: true },
  ],
  unsyncedSchools: [],
} as unknown as StaffRecordDetail;

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerStaffHirePage />
    </ToastProvider>,
  );
}

const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Walks the three entry steps with one school and lands on „Prüfen“. */
async function fillToReview() {
  renderPage();
  await screen.findByRole("heading", { name: "Person" });
  type(/^Vorname/, " Lena ");
  type(/^Nachname/, "Brandt");
  type(/^Geburtsdatum/, "1990-04-12");
  type("Personalnummer", "81001");
  type("E-Mail", "lena.brandt@example.org");
  next();
  await screen.findByRole("heading", { name: "Arbeitsvertrag" });
  type(/^Erster Tag/, "2026-12-01");
  next();
  await screen.findByRole("heading", { name: "Einsatzorte" });
  fireEvent.click(screen.getByRole("checkbox", { name: "OGS Nord" }));
  type("Stunden am Montag an der Schule OGS Nord", "5");
  type("Stunden am Dienstag an der Schule OGS Nord", "5");
  next();
  await screen.findByRole("heading", { name: "Prüfen" });
}

describe("TraegerStaffHirePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchStaffOverview.mockResolvedValue(OVERVIEW);
    api.hireStaff.mockResolvedValue(HIRED);
  });

  it("explains the release where the Träger is not released yet", async () => {
    api.fetchStaffOverview.mockResolvedValue({ ...OVERVIEW, release: null });
    renderPage();
    expect(
      await screen.findByText(
        "Personal beim Träger ist noch nicht freigeschaltet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });

  it("keeps the person on a step until its required values are there", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Person" });
    next();
    expect(
      await screen.findByText("Bitte den Vornamen eintragen."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bitte den Nachnamen eintragen."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Person" })).toBeInTheDocument();

    type(/^Vorname/, "Lena");
    type(/^Nachname/, "Brandt");
    next();
    expect(
      await screen.findByText("Bitte das Geburtsdatum wählen."),
    ).toBeInTheDocument();
    type(/^Geburtsdatum/, "1990-04-12");
    next();
    await screen.findByRole("heading", { name: "Arbeitsvertrag" });
    next();
    expect(
      await screen.findByText("Bitte den ersten Tag wählen."),
    ).toBeInTheDocument();

    type(/^Erster Tag/, "2026-12-01");
    next();
    await screen.findByRole("heading", { name: "Einsatzorte" });
    next();
    expect(
      await screen.findByText("Bitte mindestens eine Schule wählen."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "OGS Süd" }));
    next();
    expect(
      await screen.findByText(
        "Bitte für jede gewählte Schule Stunden eintragen.",
      ),
    ).toBeInTheDocument();
    expect(api.hireStaff).not.toHaveBeenCalled();
  });

  it("shows every value before it hires and names what the school does next", async () => {
    await fillToReview();
    expect(screen.getByText("Lena Brandt")).toBeInTheDocument();
    expect(screen.getByText("12.04.1990")).toBeInTheDocument();
    expect(
      screen.getByText("Teilzeit, ab 01.12.2026, unbefristet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Mo–Di je 5 Std\. · Mi–Fr frei \(10 Std\. pro Woche\)/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Person einstellen" }));
    expect(
      await screen.findByRole("heading", {
        name: "Lena Brandt ist eingestellt.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Die Schule OGS Nord richtet jetzt Zugang/),
    ).toBeInTheDocument();
    expect(api.hireStaff).toHaveBeenCalledWith({
      firstName: "Lena",
      lastName: "Brandt",
      birthday: "1990-04-12",
      email: "lena.brandt@example.org",
      phone: "",
      personnelNumber: "81001",
      kind: "part_time",
      startsOn: "2026-12-01",
      endsOn: null,
      sites: [{ schoolId: "1", weekdayMinutes: [300, 300, 0, 0, 0] }],
      confirmDuplicate: false,
    });
    expect(screen.getByRole("link", { name: "Akte öffnen" })).toHaveAttribute(
      "href",
      "/traeger/personal/9",
    );
  });

  it("asks before it hires a person who may exist already", async () => {
    api.hireStaff.mockRejectedValueOnce(
      new ApiError("duplicate", 409, {
        code: "workforce.traeger_staff_hire_duplicate",
        details: {
          matches: [
            { kind: "record", staff_record_id: 4 },
            { kind: "school", school_id: 2, school_name: "OGS Süd" },
          ],
        },
      }),
    );
    await fillToReview();
    fireEvent.click(screen.getByRole("button", { name: "Person einstellen" }));
    expect(
      await screen.findByRole("heading", {
        name: "Gibt es diese Person schon?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/An der Schule OGS Süd arbeitet die Person schon/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Akte öffnen/ })).toHaveAttribute(
      "href",
      "/traeger/personal/4",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Trotzdem einstellen" }),
    );
    await screen.findByRole("heading", {
      name: "Lena Brandt ist eingestellt.",
    });
    expect(api.hireStaff).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirmDuplicate: true }),
    );
  });

  it("marks the personnel number another record holds", async () => {
    api.hireStaff.mockRejectedValueOnce(
      new ApiError("taken", 409, { code: "workforce.personnel_number_taken" }),
    );
    await fillToReview();
    fireEvent.click(screen.getByRole("button", { name: /Person einstellen/ }));
    await screen.findByRole("heading", { name: "Person" });
    expect(
      await screen.findByText(
        "Eine andere Akte oder eine Person an der Schule hat diese Nummer.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Personalnummer")).toHaveValue("81001");
    expect(screen.getByLabelText("Personalnummer")).toBeInvalid();
  });

  it("says what exists when a hire broke off, and offers no second try", async () => {
    api.hireStaff.mockRejectedValueOnce(
      new ApiError("incomplete", 409, {
        code: "workforce.traeger_staff_hire_incomplete",
        details: { schools: ["OGS Nord"] },
      }),
    );
    await fillToReview();
    fireEvent.click(screen.getByRole("button", { name: /Person einstellen/ }));
    expect(
      await screen.findByRole("heading", {
        name: "Lena Brandt ist nur zum Teil angelegt.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Es gibt die Person jetzt an: OGS Nord\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Zu den Personalakten/ }),
    ).toHaveAttribute("href", "/traeger/personal");
    expect(
      screen.queryByRole("button", { name: /Person einstellen/ }),
    ).toBeNull();
  });
});
