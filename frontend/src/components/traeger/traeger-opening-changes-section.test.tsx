import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import type { TraegerOpeningChange } from "~/lib/traeger-opening-changes";

const { api, session } = vi.hoisted(() => ({
  api: {
    fetchTraegerOpeningChanges: vi.fn(),
    createTraegerOpeningChange: vi.fn(),
    updateTraegerOpeningChange: vi.fn(),
    deleteTraegerOpeningChange: vi.fn(),
  },
  session: { permissions: ["traeger_overview:read"] as string[] },
}));

vi.mock("~/lib/traeger-opening-changes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
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

import { TraegerOpeningChangesSection } from "./traeger-opening-changes-section";

const schools = [
  {
    id: "11",
    name: "OGS Nord",
    federalStateCode: "DE-NW",
    federalStateName: "Nordrhein-Westfalen",
  },
  {
    id: "12",
    name: "OGS Süd",
    federalStateCode: "DE-NW",
    federalStateName: "Nordrhein-Westfalen",
  },
];

function change(
  overrides: Partial<TraegerOpeningChange> = {},
): TraegerOpeningChange {
  return {
    id: "5",
    startDate: "2027-03-12",
    endDate: "2027-03-12",
    opensAt: "07:30",
    closesAt: "13:00",
    reason: "Personalversammlung",
    schoolIds: ["11", "12"],
    version: "v1",
    ...overrides,
  };
}

function render(canManage: boolean) {
  return rtlRender(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ToastProvider>
        <TraegerOpeningChangesSection
          year={2027}
          from="2027-01-01"
          to="2027-12-31"
          schools={schools}
          canManage={canManage}
        />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("TraegerOpeningChangesSection (#8202)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchTraegerOpeningChanges.mockResolvedValue([change()]);
    session.permissions = ["traeger_overview:read"];
  });

  it("zeigt den Tag mit Uhrzeit und Schulen, ohne Planen nur zum Lesen", async () => {
    render(false);

    expect(
      (await screen.findAllByText("Personalversammlung"))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("07:30 bis 13:00 Uhr")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Alle Schulen")[0]).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Tag anlegen/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Aktionen für Personalversammlung",
      }),
    ).not.toBeInTheDocument();
  });

  it("verlangt mindestens eine Schule, bevor es speichert", async () => {
    session.permissions = ["traeger_overview:read", "traeger_settings:manage"];
    render(true);

    fireEvent.click(await screen.findByRole("button", { name: /Tag anlegen/ }));
    fireEvent.change(screen.getByLabelText("Anlass"), {
      target: { value: "Personalversammlung" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Alle Schulen" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText("Bitte wähle mindestens eine Schule."),
    ).toBeInTheDocument();
    expect(api.createTraegerOpeningChange).not.toHaveBeenCalled();
  });

  it("ändert einen Tag an Ort und Stelle mit der gelesenen Version", async () => {
    session.permissions = ["traeger_overview:read", "traeger_settings:manage"];
    api.updateTraegerOpeningChange.mockResolvedValue(
      change({ schoolIds: ["11"], version: "v2" }),
    );
    render(true);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Personalversammlung",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Bearbeiten" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "OGS Süd" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.updateTraegerOpeningChange).toHaveBeenCalledWith(
        "5",
        {
          startDate: "2027-03-12",
          endDate: "2027-03-12",
          opensAt: "07:30",
          closesAt: "13:00",
          reason: "Personalversammlung",
          schoolIds: ["11"],
        },
        "v1",
      ),
    );
  });
});
