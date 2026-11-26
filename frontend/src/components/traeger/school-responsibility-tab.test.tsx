import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  EMPTY_SCHOOL_PARTY,
  type SchoolParty,
  type SchoolResponsibility,
} from "~/lib/traeger-responsibilities-api";

const { api, session } = vi.hoisted(() => ({
  api: { saveSchoolParty: vi.fn(), removeSchoolParty: vi.fn() },
  session: {
    permissions: ["traeger_overview:read", "traeger_settings:manage"],
  },
}));

vi.mock("~/lib/traeger-responsibilities-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-billing-issuers-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBillingIssuerStatuses: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "A",
        scope: "org",
        orgId: "7",
        permissions: session.permissions,
      },
    },
    status: "authenticated",
  }),
}));

import { SchoolResponsibilityTab } from "./school-responsibility-tab";

const gemeinde: SchoolParty = {
  ...EMPTY_SCHOOL_PARTY,
  kind: "gemeinde",
  name: "Gemeinde Hardt",
  street: "Rathausplatz 1",
  postalCode: "41749",
  city: "Viersen",
  contactName: "Petra Sommer",
  version: "v1",
};

function school(
  overrides: Partial<SchoolResponsibility> = {},
): SchoolResponsibility {
  return {
    schoolId: "11",
    schoolName: "OGS Nord",
    areas: [
      {
        area: "contracts",
        body: "gemeinde",
        source: "traeger",
        effective: "gemeinde",
      },
      {
        area: "billing",
        body: "gemeinde",
        source: "school",
        effective: "traeger",
      },
      {
        area: "staff",
        body: "traeger",
        source: "default",
        effective: "traeger",
      },
    ],
    parties: [gemeinde],
    ...overrides,
  };
}

function renderTab(
  value: SchoolResponsibility,
  reload = vi.fn().mockResolvedValue([value]),
) {
  render(
    <ToastProvider>
      <SchoolResponsibilityTab
        school={value}
        schools={[value]}
        reload={reload}
      />
    </ToastProvider>,
  );
  return reload;
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole("heading", {
    name: new RegExp(`^${title}`),
  });
  const section = heading.closest("section");
  if (!section) throw new Error(`no card ${title}`);
  return section;
}

describe("SchoolResponsibilityTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.permissions = ["traeger_overview:read", "traeger_settings:manage"];
  });

  it("shows who is responsible, where the value comes from and what is missing", () => {
    renderTab(school());

    const who = within(card("Wer ist zuständig"));
    // Contracts: the stored Gemeinde counts.
    expect(who.getAllByText("Gemeinde Hardt")).toHaveLength(1);
    expect(
      who.getByText("Vom Träger für alle Schulen festgelegt"),
    ).toBeInTheDocument();
    // Billing: chosen at the school, but the Träger still bills.
    expect(who.getByText("Eigener Wert")).toBeInTheDocument();
    expect(who.getByText("Gewählt: Gemeinde")).toBeInTheDocument();
    expect(who.getByText("Bankdaten fehlen")).toBeInTheDocument();
    expect(who.getByText("Standard von moto")).toBeInTheDocument();

    const body = within(card("Gemeinde"));
    expect(body.getByText("Zuständig für Verträge")).toBeInTheDocument();
    expect(body.getByText("Gläubiger-ID oder Konto fehlt")).toBeInTheDocument();
    expect(body.getByText("Rathausplatz 1")).toBeInTheDocument();
    expect(
      body.getByText(/Es fehlen Gläubiger-ID oder Bankverbindung/),
    ).toBeInTheDocument();

    // The Schulträger is not stored and nothing names it.
    const other = within(card("Schulträger"));
    expect(other.getByText("Noch keine Angaben")).toBeInTheDocument();
    expect(
      other.getByRole("button", { name: "Angaben eintragen" }),
    ).toBeInTheDocument();
  });

  it("says that the Träger stands in while a chosen body has no master data", () => {
    renderTab(
      school({
        parties: [],
        areas: [
          {
            area: "contracts",
            body: "gemeinde",
            source: "traeger",
            effective: "traeger",
          },
          {
            area: "billing",
            body: "traeger",
            source: "default",
            effective: "traeger",
          },
          {
            area: "staff",
            body: "traeger",
            source: "default",
            effective: "traeger",
          },
        ],
      }),
    );
    const body = within(card("Gemeinde"));
    expect(body.getByText("Angaben fehlen")).toBeInTheDocument();
    expect(
      body.getByText(
        "Die Einstellung nennt die Gemeinde für Verträge. Solange Name und Anschrift fehlen, bleibt der Träger zuständig.",
      ),
    ).toBeInTheDocument();
  });

  it("stores a new body and reloads the schools", async () => {
    const value = school({ parties: [] });
    api.saveSchoolParty.mockResolvedValue({ ...gemeinde, version: "v2" });
    const reload = renderTab(value);

    fireEvent.click(
      within(card("Gemeinde")).getByRole("button", {
        name: "Angaben eintragen",
      }),
    );
    const dialog = within(await screen.findByRole("dialog"));

    // Name and address are required before anything is sent.
    fireEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    expect(
      await dialog.findByText("Bitte gib den Namen an."),
    ).toBeInTheDocument();
    expect(api.saveSchoolParty).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText(/^Name der Stelle/), {
      target: { value: "Gemeinde Hardt" },
    });
    fireEvent.change(dialog.getByLabelText(/Straße und Hausnummer/), {
      target: { value: "Rathausplatz 1" },
    });
    fireEvent.change(dialog.getByLabelText(/Postleitzahl/), {
      target: { value: "41749" },
    });
    fireEvent.change(dialog.getByLabelText(/^Ort/), {
      target: { value: "Viersen" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.saveSchoolParty).toHaveBeenCalledWith(
        "11",
        "gemeinde",
        expect.objectContaining({
          name: "Gemeinde Hardt",
          postalCode: "41749",
        }),
        "",
      ),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(
      await screen.findByText("Gemeinde: Die Angaben sind gespeichert."),
    ).toBeInTheDocument();
  });

  it("shows the backend's refusal of a field at the form", async () => {
    api.saveSchoolParty.mockRejectedValue(
      new ApiError("Request failed (400)", 400, {
        code: "traeger.master_data_invalid",
        detail: "iban: is not a valid IBAN",
        errors: [{ field: "iban", reason: "is not a valid IBAN" }],
      }),
    );
    renderTab(school());

    fireEvent.click(
      within(card("Gemeinde")).getByRole("button", { name: "Ändern" }),
    );
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("IBAN"), {
      target: { value: "DE00 1234" },
    });
    fireEvent.change(dialog.getByLabelText("Kontoinhaber"), {
      target: { value: "Gemeinde Hardt" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.saveSchoolParty).toHaveBeenCalledWith(
        "11",
        "gemeinde",
        expect.objectContaining({ iban: "DE00 1234" }),
        "v1",
      ),
    );
    expect(await dialog.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no change without the right Einstellungen", () => {
    session.permissions = ["traeger_overview:read"];
    renderTab(school());
    expect(
      screen.getByText(/Du kannst die Angaben nur ansehen/),
    ).toBeInTheDocument();
    expect(screen.getByText("Rathausplatz 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ändern" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Angaben eintragen" }),
    ).toBeNull();
  });
});
