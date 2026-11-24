import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  TraegerSchoolRole,
  TraegerSchoolRoleCatalog,
  TraegerSchoolRoleList,
  TraegerSchoolRoleRemoval,
} from "~/lib/traeger-school-roles-api";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchTraegerSchoolRoles: vi.fn(),
  fetchTraegerSchoolRoleCatalog: vi.fn(),
  createTraegerSchoolRole: vi.fn(),
  updateTraegerSchoolRole: vi.fn(),
  fetchTraegerSchoolRoleRemoval: vi.fn(),
  removeTraegerSchoolRole: vi.fn(),
}));

vi.mock("~/lib/traeger-school-roles-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/einstellungen/schulrollen",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerSchoolRolesPage from "./page";

const CATALOG: TraegerSchoolRoleCatalog = {
  permissions: [
    {
      id: "1",
      name: "students:read",
      description: "",
      resource: "students",
      action: "read",
    },
    {
      id: "2",
      name: "groups:read",
      description: "",
      resource: "groups",
      action: "read",
    },
    {
      id: "3",
      name: "rooms:read",
      description: "",
      resource: "rooms",
      action: "read",
    },
  ],
  templates: { user: ["1", "2"], admin: ["1", "2", "3"] },
};

const SPRINGER: TraegerSchoolRole = {
  id: "7",
  name: "Springerkraft",
  description: "Hilft an allen Standorten aus",
  baseRole: "user",
  permissionIds: ["1", "2"],
  version: "springer-v1",
  schools: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      carried: true,
      nameTaken: false,
      holders: 3,
    },
    {
      schoolId: "2",
      schoolName: "OGS Süd",
      carried: true,
      nameTaken: false,
      holders: 0,
    },
    {
      schoolId: "3",
      schoolName: "OGS West",
      carried: false,
      nameTaken: true,
      holders: 0,
    },
  ],
};

const LIST: TraegerSchoolRoleList = { schoolCount: 3, roles: [SPRINGER] };

const REMOVAL: TraegerSchoolRoleRemoval = {
  version: "removal-v1",
  schools: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      keptForInvitations: false,
      holders: [
        { accountId: "11", name: "Mira Sommer", email: "mira@example.org" },
        { accountId: "12", name: "", email: "jonas@example.org" },
      ],
    },
    {
      schoolId: "2",
      schoolName: "OGS Süd",
      keptForInvitations: false,
      holders: [],
    },
  ],
};

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerSchoolRolesPage />
    </TraegerResourceTestProvider>,
  );
}

async function springerCard() {
  const card = (
    await screen.findByText("Springerkraft", { selector: "h2" })
  ).closest("section");
  if (!card) throw new Error("card missing");
  return card;
}

describe("TraegerSchoolRolesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTraegerSchoolRoles.mockResolvedValue(LIST);
    api.fetchTraegerSchoolRoleCatalog.mockResolvedValue(CATALOG);
  });

  it("shows what a role may do and how every school carries it", async () => {
    renderPage();
    const card = await springerCard();
    expect(within(card).getByText("Gilt als Betreuung")).toBeInTheDocument();
    expect(within(card).getByText("2 von 3")).toBeInTheDocument();
    expect(within(card).getByText("3 Personen")).toBeInTheDocument();
    expect(within(card).getByText("Noch niemand")).toBeInTheDocument();
    // Eine Schule hat den Namen schon für eine eigene Rolle: Die Karte sagt,
    // was zu tun ist, statt nur „fehlt“.
    expect(within(card).getByText("Name vergeben")).toBeInTheDocument();
    expect(
      within(card).getByText(/hat schon eine eigene Rolle mit diesem Namen/),
    ).toBeInTheDocument();

    // Die Rechte stehen erst als eine Zeile da, auf Wunsch als ganze Liste.
    // Die Rechte stehen erst je Bereich als Zahl da, auf Wunsch einzeln.
    expect(within(card).getByText("2 in 2 Bereichen")).toBeInTheDocument();
    const toggle = within(card).getByRole("button", {
      name: "Alle Rechte anzeigen",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(
      within(card).getByRole("button", { name: "Weniger anzeigen" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("creates a role with the starting rights of its tier", async () => {
    api.createTraegerSchoolRole.mockResolvedValue({
      ...SPRINGER,
      id: "8",
      name: "Standortleitung",
      baseRole: "admin",
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Rolle anlegen" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    expect(
      await within(dialog).findByText("Bitte gib einen Namen ein."),
    ).toBeInTheDocument();
    expect(api.createTraegerSchoolRole).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Name/), {
      target: { value: "Standortleitung" },
    });
    fireEvent.click(within(dialog).getByLabelText(/Verwaltung/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await waitFor(() =>
      expect(api.createTraegerSchoolRole).toHaveBeenCalledWith({
        name: "Standortleitung",
        description: "",
        baseRole: "admin",
        permissionIds: ["1", "2", "3"],
      }),
    );
    expect(
      await screen.findByText("Standortleitung", { selector: "h2" }),
    ).toBeInTheDocument();
  });

  it("saves name and rights of a role from the version it read", async () => {
    api.updateTraegerSchoolRole.mockResolvedValue({
      ...SPRINGER,
      permissionIds: ["1", "2", "3"],
      version: "springer-v2",
    });
    renderPage();
    const card = await springerCard();
    fireEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    // Die Bereiche starten zugeklappt: erst aufklappen, dann ankreuzen.
    fireEvent.click(
      await within(card).findByRole("button", { name: /^Räume/ }),
    );
    fireEvent.click(
      await within(card).findByRole("checkbox", { name: /^Räume/ }),
    );
    fireEvent.click(within(card).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.updateTraegerSchoolRole).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({
          name: "Springerkraft",
          baseRole: "user",
          permissionIds: ["1", "2", "3"],
        }),
        "springer-v1",
      ),
    );
  });

  it("names the schools that already use a name", async () => {
    api.updateTraegerSchoolRole.mockRejectedValue(
      new ApiError("conflict", 409, {
        code: "traeger.school_role_name_used_at_school",
        details: { schools: "OGS West" },
      }),
    );
    renderPage();
    const card = await springerCard();
    fireEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    fireEvent.change(await within(card).findByLabelText(/^Name/), {
      target: { value: "Hofaufsicht" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Speichern" }));
    expect(
      await within(card).findByText(
        catalogText("traeger.school_role_name_used_at_school", "").replace(
          "{schools}",
          "OGS West",
        ),
      ),
    ).toBeInTheDocument();
  });

  it("shows who loses the role before it removes anything", async () => {
    api.fetchTraegerSchoolRoleRemoval.mockResolvedValue(REMOVAL);
    api.removeTraegerSchoolRole.mockResolvedValue(undefined);
    renderPage();
    const card = await springerCard();
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Weitere Aktionen zu Springerkraft",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /Entfernen/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Mira Sommer, jonas@example.org"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/2 Personen verlieren diese Rolle/),
    ).toBeInTheDocument();
    // Eine Schule, in der niemand die Rolle hat, steht nicht in der Liste.
    expect(within(dialog).queryByText("OGS Süd")).not.toBeInTheDocument();
    expect(api.removeTraegerSchoolRole).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rolle entfernen" }),
    );
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: "Endgültig entfernen",
      }),
    );
    await waitFor(() =>
      expect(api.removeTraegerSchoolRole).toHaveBeenCalledWith(
        "7",
        "removal-v1",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Springerkraft", { selector: "h2" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/Noch keine Rolle für deine Schulen\./),
    ).toBeInTheDocument();
  });
});
